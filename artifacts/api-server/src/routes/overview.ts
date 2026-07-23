import { Router, type IRouter } from "express";
import { desc, eq, count } from "drizzle-orm";
import {
  db,
  industriesTable,
  brandsTable,
  enginesTable,
  surveyRunsTable,
  surveyResponsesTable,
} from "@workspace/db";
import { METRICS } from "../lib/metrics";
import { latestResponsesByEngine, averageEntries } from "../lib/aggregate";
import { serializeRun } from "./runs";

const router: IRouter = Router();

router.get("/overview", async (_req, res): Promise<void> => {
  const [industries, [brandCount], [engineCount], [responseCount], [lastRun]] =
    await Promise.all([
      db.select().from(industriesTable),
      db.select({ value: count() }).from(brandsTable),
      db.select({ value: count() }).from(enginesTable),
      db
        .select({ value: count() })
        .from(surveyResponsesTable)
        .where(eq(surveyResponsesTable.status, "ok")),
      db
        .select()
        .from(surveyRunsTable)
        .orderBy(desc(surveyRunsTable.startedAt))
        .limit(1),
    ]);

  const leaders: {
    industryId: number;
    industryName: string;
    metric: string;
    metricLabel: string;
    brandId: number;
    brandName: string;
    score: number;
  }[] = [];

  const hasData = (responseCount?.value ?? 0) > 0;
  if (hasData) {
    for (const industry of industries) {
      for (const metric of METRICS) {
        const responses = await latestResponsesByEngine(
          industry.id,
          metric.key,
        );
        if (responses.length === 0) continue;
        const averaged = averageEntries(
          responses.map((r) => r.response),
          metric.higherIsBetter,
        );
        const top = averaged[0];
        if (!top) continue;
        leaders.push({
          industryId: industry.id,
          industryName: industry.name,
          metric: metric.key,
          metricLabel: metric.label,
          brandId: top.brandId,
          brandName: top.brandName,
          score: top.score,
        });
      }
    }
  }

  res.status(200).json({
    lastRun: lastRun ? serializeRun(lastRun) : null,
    industriesCount: industries.length,
    brandsCount: brandCount?.value ?? 0,
    enginesCount: engineCount?.value ?? 0,
    responsesCount: responseCount?.value ?? 0,
    leaders,
  });
  return;
});

export default router;
