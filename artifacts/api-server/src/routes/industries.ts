import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, industriesTable } from "@workspace/db";
import {
  GetIndustryRankingsParams,
  GetIndustryRankingsQueryParams,
  GetIndustryTrendsParams,
  GetIndustryTrendsQueryParams,
} from "@workspace/api-zod";
import { getMetric } from "../lib/metrics";
import {
  latestResponsesByEngine,
  averageEntries,
  averageTrends,
  rankEntries,
} from "../lib/aggregate";

const router: IRouter = Router();

router.get(
  "/industries/:industryId/rankings",
  async (req, res): Promise<void> => {
    const params = GetIndustryRankingsParams.safeParse(req.params);
    const query = GetIndustryRankingsQueryParams.safeParse(req.query);
    if (!params.success || !query.success) {
      res.status(400).json({ message: "Invalid parameters" });
      return;
    }
    const metric = getMetric(query.data.metric);
    if (!metric) {
      res.status(400).json({ message: `Unknown metric: ${query.data.metric}` });
      return;
    }
    const [industry] = await db
      .select()
      .from(industriesTable)
      .where(eq(industriesTable.id, params.data.industryId));
    if (!industry) {
      res.status(404).json({ message: "Industry not found" });
      return;
    }

    const responses = await latestResponsesByEngine(industry.id, metric.key);
    res.status(200).json({
      industryId: industry.id,
      industryName: industry.name,
      metric: metric.key,
      average: averageEntries(
        responses.map((r) => r.response),
        metric.higherIsBetter,
      ),
      byEngine: responses.map(({ engine, response }) => ({
        engineKey: engine.key,
        engineName: engine.name,
        entries: rankEntries(response.entries ?? [], metric.higherIsBetter),
        surveyedAt: response.createdAt.toISOString(),
      })),
    });
    return;
  },
);

router.get(
  "/industries/:industryId/trends",
  async (req, res): Promise<void> => {
    const params = GetIndustryTrendsParams.safeParse(req.params);
    const query = GetIndustryTrendsQueryParams.safeParse(req.query);
    if (!params.success || !query.success) {
      res.status(400).json({ message: "Invalid parameters" });
      return;
    }
    const metric = getMetric(query.data.metric);
    if (!metric) {
      res.status(400).json({ message: `Unknown metric: ${query.data.metric}` });
      return;
    }
    const [industry] = await db
      .select()
      .from(industriesTable)
      .where(eq(industriesTable.id, params.data.industryId));
    if (!industry) {
      res.status(404).json({ message: "Industry not found" });
      return;
    }

    let responses = await latestResponsesByEngine(industry.id, metric.key);
    const engineKey = query.data.engine ?? null;
    if (engineKey) {
      responses = responses.filter((r) => r.engine.key === engineKey);
    }

    res.status(200).json({
      industryId: industry.id,
      industryName: industry.name,
      metric: metric.key,
      engine: engineKey,
      brands: averageTrends(responses.map((r) => r.response)),
    });
    return;
  },
);

export default router;
