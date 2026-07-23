import { Router, type IRouter } from "express";
import { desc } from "drizzle-orm";
import { db, surveyRunsTable, type SurveyRunRow } from "@workspace/db";
import { startSurveyRun, isRunInProgress } from "../lib/survey";

export function serializeRun(run: SurveyRunRow) {
  return {
    id: run.id,
    status: run.status,
    trigger: run.trigger,
    startedAt: run.startedAt.toISOString(),
    completedAt: run.completedAt ? run.completedAt.toISOString() : null,
    error: run.error,
    totalQueries: run.totalQueries,
    succeededQueries: run.succeededQueries,
    failedQueries: run.failedQueries,
  };
}

const router: IRouter = Router();

router.get("/runs", async (_req, res): Promise<void> => {
  const runs = await db
    .select()
    .from(surveyRunsTable)
    .orderBy(desc(surveyRunsTable.startedAt))
    .limit(50);
  res.status(200).json(runs.map(serializeRun));
  return;
});

router.post("/runs", async (req, res): Promise<void> => {
  if (isRunInProgress()) {
    res.status(409).json({ message: "A survey run is already in progress" });
    return;
  }
  const run = await startSurveyRun("manual");
  if (!run) {
    res.status(409).json({ message: "A survey run is already in progress" });
    return;
  }
  req.log.info({ runId: run.id }, "Manual survey run triggered");
  res.status(202).json(serializeRun(run));
  return;
});

export default router;
