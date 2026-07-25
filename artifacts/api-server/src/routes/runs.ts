import { Router, type IRouter } from "express";
import { and, desc, eq, gte, lt, sql } from "drizzle-orm";
import {
  db,
  surveyRunsTable,
  industriesTable,
  enginesTable,
  brandAlertsTable,
  surveyResponsesTable,
  trendSnapshotsTable,
  dailyMeasurementsTable,
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
  reconcileStaleRuns,
} from "../lib/survey";
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
    engineId: run.engineId ?? null,
    startedAt: run.startedAt.toISOString(),
    completedAt: run.completedAt ? run.completedAt.toISOString() : null,
    heartbeatAt: run.heartbeatAt ? run.heartbeatAt.toISOString() : null,
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

const RUN_STATUSES = [
  "running",
  "pausing",
  "cancelling",
  "paused",
  "completed",
  "partial",
  "failed",
  "cancelled",
] as const;

/** Parses a YYYY-MM-DD query value into a UTC date, or undefined. */
function parseDateParam(raw: unknown): Date | undefined {
  if (typeof raw !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    return undefined;
  }
  const d = new Date(`${raw}T00:00:00.000Z`);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

router.get("/runs", async (req, res): Promise<void> => {
  const rawStatus = req.query.status;
  const status =
    typeof rawStatus === "string" &&
    (RUN_STATUSES as readonly string[]).includes(rawStatus)
      ? rawStatus
      : undefined;
  const rawLimit = Number(req.query.limit);
  const limit =
    Number.isInteger(rawLimit) && rawLimit > 0 ? Math.min(rawLimit, 200) : 50;
  const from = parseDateParam(req.query.from);
  const toDay = parseDateParam(req.query.to);
  // "to" is an inclusive calendar date — cover the whole day.
  const to = toDay ? new Date(toDay.getTime() + 24 * 60 * 60 * 1000) : undefined;
  const rawTrigger = req.query.trigger;
  const trigger =
    rawTrigger === "scheduled" || rawTrigger === "manual" || rawTrigger === "auto"
      ? rawTrigger
      : undefined;
  const rawEngineId = Number(req.query.engineId);
  const engineId =
    Number.isInteger(rawEngineId) && rawEngineId > 0 ? rawEngineId : undefined;

  const conditions = [
    status ? eq(surveyRunsTable.status, status) : undefined,
    trigger ? eq(surveyRunsTable.trigger, trigger) : undefined,
    engineId ? eq(surveyRunsTable.engineId, engineId) : undefined,
    from ? gte(surveyRunsTable.startedAt, from) : undefined,
    to ? lt(surveyRunsTable.startedAt, to) : undefined,
  ].filter((c): c is NonNullable<typeof c> => c !== undefined);

  const runs = await db
    .select()
    .from(surveyRunsTable)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(surveyRunsTable.startedAt))
    .limit(limit);
  res.status(200).json(runs.map(serializeRun));
  return;
});

// Scheduler cadence, mirrored from scheduler.ts / the daily cron. The next
// scheduled fire is the next 06:00 UTC.
const RUN_HOUR_UTC = 6;
function nextScheduledRun(): string {
  const now = new Date();
  const next = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), RUN_HOUR_UTC),
  );
  if (next.getTime() <= now.getTime()) next.setUTCDate(next.getUTCDate() + 1);
  return next.toISOString();
}

// Ops summary for the console: first run, last run, next scheduled fire, and
// status counts. Public (read-only), like the rest of run history.
router.get("/runs/summary", async (_req, res): Promise<void> => {
  const [firstRow] = await db
    .select()
    .from(surveyRunsTable)
    .orderBy(surveyRunsTable.startedAt)
    .limit(1);
  const [lastRow] = await db
    .select()
    .from(surveyRunsTable)
    .orderBy(desc(surveyRunsTable.startedAt))
    .limit(1);
  const [{ total } = { total: 0 }] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(surveyRunsTable);
  const statusRows = await db
    .select({ status: surveyRunsTable.status, count: sql<number>`count(*)::int` })
    .from(surveyRunsTable)
    .groupBy(surveyRunsTable.status);
  const active = statusRows
    .filter((r) => ["running", "pausing", "cancelling"].includes(r.status))
    .reduce((n, r) => n + r.count, 0);

  res.status(200).json({
    totalRuns: total,
    activeRuns: active,
    firstRun: firstRow ? serializeRun(firstRow) : null,
    lastRun: lastRow ? serializeRun(lastRow) : null,
    nextScheduledRun: nextScheduledRun(),
    statusCounts: Object.fromEntries(statusRows.map((r) => [r.status, r.count])),
  });
  return;
});

/**
 * Push a problem run into the alert queue as a run_issue alert, so failed
 * or degraded runs surface alongside brand alerts (and their unread badge).
 */
router.post(
  "/runs/:runId/report-issue",
  requireAdmin,
  async (req, res): Promise<void> => {
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

    const hasIssues =
      run.failedQueries > 0 ||
      run.status === "failed" ||
      run.error != null ||
      (run.keyWarnings != null && run.keyWarnings.length > 0);
    if (!hasIssues) {
      res.status(400).json({ message: "This run has no issues to report" });
      return;
    }

    const [existing] = await db
      .select({ id: brandAlertsTable.id })
      .from(brandAlertsTable)
      .where(
        and(
          eq(brandAlertsTable.runId, runId),
          eq(brandAlertsTable.kind, "run_issue"),
        ),
      );
    if (existing) {
      res
        .status(409)
        .json({ message: "This run is already in the alert queue" });
      return;
    }

    let scopeName = "All industries";
    if (run.industryId != null) {
      const [industry] = await db
        .select({ name: industriesTable.name })
        .from(industriesTable)
        .where(eq(industriesTable.id, run.industryId));
      scopeName = industry?.name ?? `Industry ${run.industryId}`;
    }

    const [alert] = await db
      .insert(brandAlertsTable)
      .values({
        runId,
        brandId: null,
        brandName: `Run #${runId}`,
        industryId: run.industryId ?? null,
        industryName: scopeName,
        metricKey: "run_issue",
        metricLabel: "Survey run issue",
        kind: "run_issue",
        previousValue: run.totalQueries,
        currentValue: run.failedQueries,
        delta: run.failedQueries,
        threshold: 0,
      })
      .returning();
    if (!alert) {
      res.status(500).json({ message: "Failed to create alert" });
      return;
    }
    req.log.info({ runId, alertId: alert.id }, "Run issue pushed to alerts");
    res.status(201).json({
      id: alert.id,
      runId: alert.runId,
      brandId: alert.brandId,
      brandName: alert.brandName,
      industryId: alert.industryId,
      industryName: alert.industryName,
      metric: alert.metricKey,
      metricLabel: alert.metricLabel,
      kind: alert.kind,
      previousValue: alert.previousValue,
      currentValue: alert.currentValue,
      delta: alert.delta,
      threshold: alert.threshold,
      read: alert.read,
      createdAt: alert.createdAt.toISOString(),
    });
  },
);

// Manually run the stale-run watchdog: finalize any run stuck in an active
// state whose heartbeat has gone silent. Gives admins a one-click way to clear
// a wedged run without waiting for the periodic sweep.
router.post("/runs/reconcile", requireAdmin, async (req, res): Promise<void> => {
  const finalized = await reconcileStaleRuns();
  req.log.info({ finalized }, "Manual stale-run reconcile");
  res.status(200).json({
    finalized,
    message:
      finalized > 0
        ? `Finalized ${finalized} stale run(s).`
        : "No stale runs found — anything still running is actively progressing.",
  });
  return;
});

router.post("/runs", requireAdmin, async (req, res): Promise<void> => {
  if (isRunInProgress()) {
    res.status(409).json({ message: "A survey run is already in progress" });
    return;
  }

  const body = req.body as { industryId?: unknown; engineId?: unknown } | undefined;

  let industryId: number | undefined;
  if (body?.industryId != null) {
    industryId = Number(body.industryId);
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

  let engineId: number | undefined;
  if (body?.engineId != null) {
    engineId = Number(body.engineId);
    if (!Number.isInteger(engineId) || engineId <= 0) {
      res.status(400).json({ message: "engineId must be a positive integer" });
      return;
    }
    const [engine] = await db
      .select()
      .from(enginesTable)
      .where(eq(enginesTable.id, engineId));
    if (!engine) {
      res.status(404).json({ message: "Engine not found" });
      return;
    }
    if (!engine.enabled) {
      res.status(400).json({ message: "Engine is disabled" });
      return;
    }
  }

  const result = await startSurveyRun("manual", industryId, engineId);
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

/** Deletes a run and every row that references it, in FK-safe order. */
async function deleteRunCascade(runId: number): Promise<void> {
  await db.delete(trendSnapshotsTable).where(eq(trendSnapshotsTable.runId, runId));
  await db
    .delete(dailyMeasurementsTable)
    .where(eq(dailyMeasurementsTable.runId, runId));
  await db.delete(brandAlertsTable).where(eq(brandAlertsTable.runId, runId));
  await db
    .delete(surveyResponsesTable)
    .where(eq(surveyResponsesTable.runId, runId));
  await db.delete(surveyRunsTable).where(eq(surveyRunsTable.id, runId));
}

// Clear all failed runs in one call. Must come before the parameterized
// ":runId" delete so "failed" isn't parsed as an id.
router.delete("/runs/failed", requireAdmin, async (req, res): Promise<void> => {
  const failed = await db
    .select({ id: surveyRunsTable.id })
    .from(surveyRunsTable)
    .where(eq(surveyRunsTable.status, "failed"));
  for (const { id } of failed) {
    await deleteRunCascade(id);
  }
  req.log.info({ count: failed.length }, "Cleared failed survey runs");
  res.status(200).json({ message: `Deleted ${failed.length} failed run(s)` });
  return;
});

router.delete("/runs/:runId", requireAdmin, async (req, res): Promise<void> => {
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
  if (["running", "pausing", "cancelling"].includes(run.status)) {
    res.status(409).json({
      message: "Cancel this run before deleting it",
    });
    return;
  }
  await deleteRunCascade(runId);
  req.log.info({ runId }, "Survey run deleted");
  res.status(200).json({ message: "Run deleted" });
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
