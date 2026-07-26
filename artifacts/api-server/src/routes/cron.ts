import { Router, type IRouter } from "express";
import { desc, eq } from "drizzle-orm";
import { db, surveyRunsTable } from "@workspace/db";
import {
  startSurveyRun,
  resumeSurveyRun,
  isRunInProgress,
} from "../lib/survey";
import { dueSchedules, markScheduleFired } from "../lib/schedules";
import { maybeGenerateWeeklyAnalysis } from "../lib/analysis";
import { logger } from "../lib/logger";

/**
 * Serverless replacement for the in-process daily scheduler (scheduler.ts).
 *
 * Vercel Cron (see vercel.json) calls GET /api/internal/cron/daily-survey
 * once per day with "Authorization: Bearer $CRON_SECRET". Each invocation:
 *   1. resumes a stale "running" run left behind by a timed-out previous
 *      invocation (resumeSurveyRun skips queries that already have stored
 *      responses), or
 *   2. starts today's scheduled run if none has started yet, then
 *   3. holds the request open — polling run status — until the run finishes
 *      or the invocation time budget is spent, so the work isn't frozen
 *      when the response is sent.
 *
 * A run larger than one invocation's budget completes across multiple
 * invocations (hit the endpoint again, or add more cron entries on plans
 * that allow sub-daily schedules).
 */

const DEFAULT_TIME_BUDGET_MS = 250_000; // under the 300s function maxDuration
const POLL_INTERVAL_MS = 5_000;

function timeBudgetMs(): number {
  const raw = Number(process.env.CRON_TIME_BUDGET_MS);
  return Number.isFinite(raw) && raw > 10_000 ? raw : DEFAULT_TIME_BUDGET_MS;
}

async function runStatus(
  runId: number,
): Promise<{ status: string; succeeded: number; failed: number } | null> {
  const [row] = await db
    .select({
      status: surveyRunsTable.status,
      succeeded: surveyRunsTable.succeededQueries,
      failed: surveyRunsTable.failedQueries,
    })
    .from(surveyRunsTable)
    .where(eq(surveyRunsTable.id, runId));
  return row ?? null;
}

async function waitForRun(
  runId: number,
  deadline: number,
): Promise<{ status: string; succeeded: number; failed: number } | null> {
  let last = await runStatus(runId);
  while (last && last.status === "running" && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
    last = await runStatus(runId);
  }
  return last;
}

const router: IRouter = Router();

router.get("/internal/cron/daily-survey", async (req, res): Promise<void> => {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    res.status(503).json({ message: "CRON_SECRET is not configured" });
    return;
  }
  if (req.headers.authorization !== `Bearer ${secret}`) {
    res.status(401).json({ message: "Unauthorized" });
    return;
  }

  const deadline = Date.now() + timeBudgetMs();

  // 0. Weekly Fable analysis of the 13-week lookback overlap (throttled to once
  // per ~7 days internally, so it's safe to attempt every invocation). Only
  // when no run is in progress, so it doesn't compete for the time budget.
  if (!isRunInProgress()) {
    try {
      const report = await maybeGenerateWeeklyAnalysis(new Date());
      if (report) {
        res.status(200).json({ action: "weekly_analysis", reportId: report.id });
        return;
      }
    } catch (err) {
      logger.error({ err }, "Weekly analysis generation failed");
    }
  }

  // 1. Resume a run orphaned by a previous timed-out invocation. Skip when
  // this instance is already processing one (fresh warm invocation).
  if (!isRunInProgress()) {
    const [orphan] = await db
      .select()
      .from(surveyRunsTable)
      .where(eq(surveyRunsTable.status, "running"))
      .orderBy(desc(surveyRunsTable.startedAt))
      .limit(1);
    if (orphan) {
      logger.info({ runId: orphan.id }, "Cron: resuming orphaned survey run");
      const resumed = await resumeSurveyRun(orphan);
      if (resumed.ok) {
        const final = await waitForRun(orphan.id, deadline);
        res.status(200).json({ action: "resumed", runId: orphan.id, ...final });
        return;
      }
      res
        .status(200)
        .json({ action: "resume_failed", runId: orphan.id, message: resumed.message });
      return;
    }
  }

  // 2. Fire every schedule that's due, sequentially within the time budget.
  const now = new Date();
  const due = await dueSchedules(now);
  if (due.length === 0) {
    res.status(200).json({ action: "skipped", reason: "no schedules due" });
    return;
  }
  if (isRunInProgress()) {
    res.status(200).json({ action: "skipped", reason: "run in progress" });
    return;
  }

  const fired: Record<string, unknown>[] = [];
  for (const schedule of due) {
    if (Date.now() >= deadline) break;
    const result = await startSurveyRun(
      "scheduled",
      schedule.industryId ?? undefined,
      schedule.engineId ?? undefined,
      (schedule.queryScope as "current" | "trend" | "both") ?? "both",
    );
    if (result.kind === "started") {
      await markScheduleFired(schedule, result.run.id, now);
      const final = await waitForRun(result.run.id, deadline);
      fired.push({ scheduleId: schedule.id, runId: result.run.id, status: final?.status });
    } else if (result.kind === "blocked") {
      await markScheduleFired(schedule, result.run.id, now);
      fired.push({ scheduleId: schedule.id, runId: result.run.id, blocked: true });
      break; // a provider key is failing — stop and surface it
    } else if (result.kind === "skipped") {
      // Scoped schedule with nothing to survey — advance so it doesn't loop.
      await markScheduleFired(schedule, null, now);
      fired.push({ scheduleId: schedule.id, skipped: true });
    } else {
      break; // in_progress — another run took the lock; catch next invocation
    }
  }
  res.status(200).json({ action: "schedules", fired });
});

export default router;
