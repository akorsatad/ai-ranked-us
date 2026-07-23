import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, industriesTable, enginesTable } from "@workspace/db";
import {
  GetIndustryRankingsParams,
  GetIndustryRankingsQueryParams,
  GetIndustryTrendsParams,
  GetIndustryTrendsQueryParams,
  GetIndustryHistoryParams,
  GetIndustryHistoryQueryParams,
  ListTrendSnapshotsParams,
  ListTrendSnapshotsQueryParams,
  GetTrendSnapshotParams,
  GetTrendSnapshotQueryParams,
} from "@workspace/api-zod";
import { getMetric } from "../lib/metrics";
import {
  latestResponsesByEngine,
  averageEntries,
  averageTrends,
  rankEntries,
  runSnapshots,
} from "../lib/aggregate";
import {
  measuredSeries,
  listSnapshotDates,
  snapshotsForDate,
} from "../lib/series";

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
      byEngine: responses.map(({ engine, response, previousResponse }) => {
        // Per-engine previous-run ranks (this engine's own prior response,
        // not the averaged snapshot).
        const enginePrevRankByBrand = new Map(
          rankEntries(
            previousResponse?.entries ?? [],
            metric.higherIsBetter,
          ).map((e) => [e.brandId, e.rank]),
        );
        return {
          engineKey: engine.key,
          engineName: engine.name,
          entries: rankEntries(response.entries ?? [], metric.higherIsBetter).map(
            (entry) => ({
              ...entry,
              previousRank: enginePrevRankByBrand.get(entry.brandId) ?? null,
            }),
          ),
          surveyedAt: response.createdAt.toISOString(),
        };
      }),
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

    let engineId: number | undefined;
    if (query.data.engine) {
      const [engine] = await db
        .select()
        .from(enginesTable)
        .where(eq(enginesTable.key, query.data.engine));
      if (!engine) {
        res.status(404).json({ message: "Engine not found" });
        return;
      }
      engineId = engine.id;
    }

    const { series, runsCount } = await measuredSeries(
      industry.id,
      metric.key,
      engineId,
    );

    res.status(200).json({
      industryId: industry.id,
      industryName: industry.name,
      metric: metric.key,
      runsCount,
      brands: series.map((s) => ({
        brandId: s.brandId,
        brandName: s.brandName,
        points: s.points.map((p) => ({
          runId: p.runId,
          date: p.date,
          score: p.score,
        })),
      })),
    });
    return;
  },
);

router.get(
  "/industries/:industryId/trend-snapshots",
  async (req, res): Promise<void> => {
    const params = ListTrendSnapshotsParams.safeParse(req.params);
    const query = ListTrendSnapshotsQueryParams.safeParse(req.query);
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

    let engineId: number | undefined;
    if (query.data.engine) {
      const [engine] = await db
        .select()
        .from(enginesTable)
        .where(eq(enginesTable.key, query.data.engine));
      if (!engine) {
        res.status(404).json({ message: "Engine not found" });
        return;
      }
      engineId = engine.id;
    }

    const snapshots = await listSnapshotDates(
      industry.id,
      metric.key,
      engineId,
    );

    res.status(200).json({
      industryId: industry.id,
      industryName: industry.name,
      metric: metric.key,
      snapshots,
    });
    return;
  },
);

router.get(
  "/industries/:industryId/trend-snapshots/:date",
  async (req, res): Promise<void> => {
    const params = GetTrendSnapshotParams.safeParse(req.params);
    const query = GetTrendSnapshotQueryParams.safeParse(req.query);
    if (!params.success || !query.success) {
      res.status(400).json({ message: "Invalid parameters" });
      return;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(params.data.date)) {
      res.status(400).json({ message: "Invalid date, expected YYYY-MM-DD" });
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

    let engineId: number | undefined;
    const engineKey = query.data.engine ?? null;
    if (engineKey) {
      const [engine] = await db
        .select()
        .from(enginesTable)
        .where(eq(enginesTable.key, engineKey));
      if (!engine) {
        res.status(404).json({ message: "Engine not found" });
        return;
      }
      engineId = engine.id;
    }

    const rows = await snapshotsForDate(
      industry.id,
      metric.key,
      params.data.date,
      engineId,
    );
    if (rows.length === 0) {
      res.status(404).json({ message: "No snapshot for that date" });
      return;
    }

    res.status(200).json({
      industryId: industry.id,
      industryName: industry.name,
      metric: metric.key,
      date: params.data.date,
      engine: engineKey,
      brands: averageTrends(rows),
    });
    return;
  },
);

export default router;
