import { Router, type IRouter } from "express";
import { desc, eq } from "drizzle-orm";
import {
  db,
  surveyRunsTable,
  industriesTable,
  type SurveyRunRow,
} from "@workspace/db";
import { startSurveyRun, isRunInProgress } from "../lib/survey";

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

  const run = await startSurveyRun("manual", industryId);
  if (!run) {
    res.status(409).json({ message: "A survey run is already in progress" });
    return;
  }
  req.log.info(
    { runId: run.id, industryId: industryId ?? null },
    "Manual survey run triggered",
  );
  res.status(202).json(serializeRun(run));
  return;
});

export default router;
