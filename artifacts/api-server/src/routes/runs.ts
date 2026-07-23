import { Router, type IRouter } from "express";
import { desc, eq } from "drizzle-orm";
import {
  db,
  surveyRunsTable,
  industriesTable,
  type SurveyRunRow,
} from "@workspace/db";
import { requireAdmin } from "../middlewares/requireAdmin";
import { decideRunControl } from "../lib/runControl";
import {
  startSurveyRun,
  resumeSurveyRun,
  isRunInProgress,
  getActiveRunId,
  signalRun,
  describeKeyFailures,
} from "../lib/survey";
import { surveyResponsesTable } from "@workspace/db";

async function responseCounts(
  runId: number,
): Promise<{ succeeded: number; failed: number }> {
  const rows = await db
    .select({ status: surveyResponsesTable.status })
    .from(surveyResponsesTable)
    .where(eq(surveyResponsesTable.runId, runId));
  const succeeded = rows.filter((r) => r.status === "ok").length;
  return { succeeded, failed: rows.length - succeeded };
}

async function getRun(runId: number): Promise<SurveyRunRow | undefined> {
  const [run] = await db
    .select()
    .from(surveyRunsTable)
    .where(eq(surveyRunsTable.id, runId));
  return run;
}

function parseRunId(raw: string): number | null {
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
}

export function serializeRun(run: SurveyRunRow) {
  return {
    id: run.id,
    status: run.status,
    trigger: run.trigger,
    industryId: run.industryId ?? null,
    startedAt: run.startedAt.toISOString(),
    completedAt: run.completedAt ? run.completedAt.toISOString() : null,
    error: run.error,
    totalQueries: run.totalQueries,
    succeededQueries: run.succeededQueries,
    failedQueries: run.failedQueries,
    keyWarnings: run.keyWarnings ?? null,
    totalInputTokens: run.totalInputTokens,
    totalOutputTokens: run.totalOutputTokens,
    totalCostUsd: run.totalCostUsd,
  };
}

const router: IRouter = Router();

// Reading run history is public; anything that mutates runs (trigger,
// pause, resume, cancel) requires the authenticated admin.

router.get("/runs", async (_req, res): Promise<void> => {
  const runs = await db
    .select()
    .from(surveyRunsTable)
    .orderBy(desc(surveyRunsTable.startedAt))
    .limit(50);
  res.status(200).json(runs.map(serializeRun));
  return;
});

router.post("/runs", requireAdmin, async (req, res): Promise<void> => {
  if (isRunInProgress()) {
    res.status(409).json({ message: "A survey run is already in progress" });
    return;
  }

  let industryId: number | undefined;
  const rawIndustryId = (req.body as { industryId?: unknown } | undefined)
    ?.industryId;
  if (rawIndustryId != null) {
    industryId = Number(rawIndustryId);
    if (!Number.isInteger(industryId) || industryId <= 0) {
      res.status(400).json({ message: "industryId must be a positive integer" });
      return;
    }
    const [industry] = await db
      .select()
      .from(industriesTable)
      .where(eq(industriesTable.id, industryId));
    if (!industry) {
      res.status(404).json({ message: "Industry not found" });
      return;
    }
    if (!industry.enabled) {
      res.status(400).json({ message: "Industry is disabled" });
      return;
    }
  }

  const result = await startSurveyRun("manual", industryId);
  if (result.kind === "in_progress") {
    res.status(409).json({ message: "A survey run is already in progress" });
    return;
  }
  if (result.kind === "skipped") {
    // Manual runs are never skipped (only auto scoped runs are), but keep
    // the handling exhaustive.
    res.status(409).json({ message: "Nothing to survey" });
    return;
  }
  if (result.kind === "blocked") {
    req.log.warn(
      { runId: result.run.id, failures: result.failures },
      "Manual survey run blocked by key pre-flight check",
    );
    res.status(422).json({
      message: `Run refused: provider key check failed — ${describeKeyFailures(result.failures)}`,
    });
    return;
  }
  req.log.info(
    { runId: result.run.id, industryId: industryId ?? null },
    "Manual survey run triggered",
  );
  res.status(202).json(serializeRun(result.run));
  return;
});

router.post("/runs/:runId/pause", requireAdmin, async (req, res): Promise<void> => {
  const runId = parseRunId(String(req.params.runId));
  if (runId == null) {
    res.status(400).json({ message: "Invalid run id" });
    return;
  }
  const run = await getRun(runId);
  if (!run) {
    res.status(404).json({ message: "Run not found" });
    return;
  }
  const decision = decideRunControl(
    "pause",
    run.status,
    getActiveRunId() === runId,
  );
  if (decision.kind === "reject") {
    res.status(decision.httpStatus).json({ message: decision.message });
    return;
  }

  if (decision.kind === "signal") {
    // Active loop: mark as pausing and signal it; the loop finalizes counts.
    signalRun(runId, "pause");
    const [updated] = await db
      .update(surveyRunsTable)
      .set({ status: "pausing" })
      .where(eq(surveyRunsTable.id, runId))
      .returning();
    req.log.info({ runId }, "Survey run pause requested");
    res.status(202).json(serializeRun(updated ?? run));
  } else {
    // Stale "running" row (e.g. server restarted mid-run): pause directly.
    const { succeeded, failed } = await responseCounts(runId);
    const [updated] = await db
      .update(surveyRunsTable)
      .set({ status: "paused", succeededQueries: succeeded, failedQueries: failed })
      .where(eq(surveyRunsTable.id, runId))
      .returning();
    req.log.info({ runId }, "Stale survey run paused directly");
    res.status(200).json(serializeRun(updated ?? run));
  }
  return;
});

router.post("/runs/:runId/resume", requireAdmin, async (req, res): Promise<void> => {
  const runId = parseRunId(String(req.params.runId));
  if (runId == null) {
    res.status(400).json({ message: "Invalid run id" });
    return;
  }
  const run = await getRun(runId);
  if (!run) {
    res.status(404).json({ message: "Run not found" });
    return;
  }
  const decision = decideRunControl("resume", run.status, false);
  if (decision.kind === "reject") {
    res.status(decision.httpStatus).json({ message: decision.message });
    return;
  }
  const result = await resumeSurveyRun(run);
  if (!result.ok) {
    res.status(409).json({ message: result.message });
    return;
  }
  const updated = await getRun(runId);
  req.log.info({ runId }, "Survey run resumed");
  res.status(202).json(serializeRun(updated ?? run));
  return;
});

router.post("/runs/:runId/cancel", requireAdmin, async (req, res): Promise<void> => {
  const runId = parseRunId(String(req.params.runId));
  if (runId == null) {
    res.status(400).json({ message: "Invalid run id" });
    return;
  }
  const run = await getRun(runId);
  if (!run) {
    res.status(404).json({ message: "Run not found" });
    return;
  }
  const decision = decideRunControl(
    "cancel",
    run.status,
    getActiveRunId() === runId,
  );
  if (decision.kind === "reject") {
    res.status(decision.httpStatus).json({ message: decision.message });
    return;
  }

  if (decision.kind === "signal") {
    // Active loop: mark as cancelling and signal it; the loop finalizes counts.
    signalRun(runId, "cancel");
    const [updated] = await db
      .update(surveyRunsTable)
      .set({ status: "cancelling" })
      .where(eq(surveyRunsTable.id, runId))
      .returning();
    req.log.info({ runId }, "Survey run cancel requested");
    res.status(202).json(serializeRun(updated ?? run));
  } else {
    // Paused run, or stale "running" row with no active loop: cancel directly.
    const { succeeded, failed } = await responseCounts(runId);
    const [updated] = await db
      .update(surveyRunsTable)
      .set({
        status: "cancelled",
        completedAt: new Date(),
        succeededQueries: succeeded,
        failedQueries: failed,
      })
      .where(eq(surveyRunsTable.id, runId))
      .returning();
    req.log.info({ runId }, "Survey run cancelled directly");
    res.status(200).json(serializeRun(updated ?? run));
  }
  return;
});

export default router;
