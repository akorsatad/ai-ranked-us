import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, industriesTable } from "@workspace/db";
import {
  GetIndustryRankingsParams,
  GetIndustryRankingsQueryParams,
  GetIndustryTrendsParams,
  GetIndustryTrendsQueryParams,
  GetIndustryHistoryParams,
  GetIndustryHistoryQueryParams,
} from "@workspace/api-zod";
import { getMetric } from "../lib/metrics";
import {
  latestResponsesByEngine,
  averageEntries,
  averageTrends,
  rankEntries,
  runSnapshots,
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
    const snapshots = await runSnapshots(
      industry.id,
      metric.key,
      metric.higherIsBetter,
    );
    // Previous run = second-most-recent snapshot; null when only one run exists.
    const previousSnapshot =
      snapshots.length >= 2 ? snapshots[snapshots.length - 2] : null;
    const previousRankByBrand = new Map(
      (previousSnapshot?.entries ?? []).map((e) => [e.brandId, e.rank]),
    );
    res.status(200).json({
      industryId: industry.id,
      industryName: industry.name,
      metric: metric.key,
      average: averageEntries(
        responses.map((r) => r.response),
        metric.higherIsBetter,
      ).map((entry) => ({
        ...entry,
        previousRank: previousRankByBrand.get(entry.brandId) ?? null,
      })),
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

router.get(
  "/industries/:industryId/history",
  async (req, res): Promise<void> => {
    const params = GetIndustryHistoryParams.safeParse(req.params);
    const query = GetIndustryHistoryQueryParams.safeParse(req.query);
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

    const snapshots = await runSnapshots(
      industry.id,
      metric.key,
      metric.higherIsBetter,
    );

    const byBrand = new Map<
      number,
      { brandName: string; points: { runId: number; date: string; score: number }[] }
    >();
    for (const snapshot of snapshots) {
      for (const entry of snapshot.entries) {
        let acc = byBrand.get(entry.brandId);
        if (!acc) {
          acc = { brandName: entry.brandName, points: [] };
          byBrand.set(entry.brandId, acc);
        }
        acc.points.push({
          runId: snapshot.runId,
          date: snapshot.date,
          score: entry.score,
        });
      }
    }

    res.status(200).json({
      industryId: industry.id,
      industryName: industry.name,
      metric: metric.key,
      runsCount: snapshots.length,
      brands: [...byBrand.entries()].map(([brandId, acc]) => ({
        brandId,
        brandName: acc.brandName,
        points: acc.points,
      })),
    });
    return;
  },
);

export default router;
