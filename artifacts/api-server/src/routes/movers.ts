import { Router, type IRouter } from "express";
import { inArray, eq, and } from "drizzle-orm";
import {
  db,
  industriesTable,
  surveyRunsTable,
  surveyResponsesTable,
} from "@workspace/db";
import { METRICS } from "../lib/metrics";
import { buildMoversReport } from "../lib/movers";
import { RANKING_QUERY_TYPES } from "../lib/aggregate";

const router: IRouter = Router();

/**
 * Biggest movers between the two most recent runs that produced data,
 * anchored on a single global run pair. Only industry/metric pairs with
 * successful responses in BOTH runs are compared — no stale backfill.
 */
router.get("/movers", async (_req, res): Promise<void> => {
  // Runs that have at least one ok response, newest first.
  const runsWithData = await db
    .selectDistinct({ runId: surveyResponsesTable.runId })
    .from(surveyResponsesTable)
    .where(eq(surveyResponsesTable.status, "ok"));
  const runIds = runsWithData.map((r) => r.runId);

  if (runIds.length < 2) {
    res.status(200).json({
      latestRunId: null,
      previousRunId: null,
      latestRunAt: null,
      previousRunAt: null,
      movers: [],
    });
    return;
  }

  const runs = await db
    .select()
    .from(surveyRunsTable)
    .where(inArray(surveyRunsTable.id, runIds));
  runs.sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime());
  const latestRun = runs[0]!;
  const previousRun = runs[1]!;

  const [industries, responses] = await Promise.all([
    db.select().from(industriesTable),
    db
      .select()
      .from(surveyResponsesTable)
      .where(
        and(
          inArray(surveyResponsesTable.runId, [latestRun.id, previousRun.id]),
          eq(surveyResponsesTable.status, "ok"),
          inArray(surveyResponsesTable.queryType, RANKING_QUERY_TYPES),
        ),
      ),
  ]);

  const report = buildMoversReport({
    latestRun,
    previousRun,
    responses,
    industries,
    metrics: METRICS,
  });

  res.status(200).json(report);
  return;
});

export default router;
