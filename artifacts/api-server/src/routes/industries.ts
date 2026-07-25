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
  loadModelWeights,
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

    const weights = await loadModelWeights();
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

    // Group the per-(engine,model) responses back to one row per engine for the
    // "by engine" breakdown, blending the engine's models by weight.
    const byEngineGroups = new Map<
      number,
      {
        engine: (typeof responses)[number]["engine"];
        latest: typeof responses;
        previous: typeof responses;
        surveyedAt: Date;
      }
    >();
    for (const r of responses) {
      let g = byEngineGroups.get(r.engine.id);
      if (!g) {
        g = { engine: r.engine, latest: [], previous: [], surveyedAt: r.response.createdAt };
        byEngineGroups.set(r.engine.id, g);
      }
      g.latest.push(r);
      if (r.response.createdAt > g.surveyedAt) g.surveyedAt = r.response.createdAt;
      if (r.previousResponse) g.previous.push(r);
    }

    res.status(200).json({
      industryId: industry.id,
      industryName: industry.name,
      metric: metric.key,
      average: averageEntries(
        responses.map((r) => r.response),
        metric.higherIsBetter,
        weights,
      ).map((entry) => ({
        ...entry,
        previousRank: previousRankByBrand.get(entry.brandId) ?? null,
      })),
      byEngine: [...byEngineGroups.values()].map((g) => {
        // This engine's own prior ranks, blended across its models.
        const enginePrevRankByBrand = new Map(
          averageEntries(
            g.previous.map((r) => r.previousResponse!),
            metric.higherIsBetter,
            weights,
          ).map((e) => [e.brandId, e.rank]),
        );
        return {
          engineKey: g.engine.key,
          engineName: g.engine.name,
          entries: averageEntries(
            g.latest.map((r) => r.response),
            metric.higherIsBetter,
            weights,
          ).map((entry) => ({
            ...entry,
            previousRank: enginePrevRankByBrand.get(entry.brandId) ?? null,
          })),
          surveyedAt: g.surveyedAt.toISOString(),
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

    const weights = await loadModelWeights();
    let responses = await latestResponsesByEngine(
      industry.id,
      metric.key,
      "trend",
    );
    const engineKey = query.data.engine ?? null;
    if (engineKey) {
      responses = responses.filter((r) => r.engine.key === engineKey);
    }

    res.status(200).json({
      industryId: industry.id,
      industryName: industry.name,
      metric: metric.key,
      engine: engineKey,
      brands: averageTrends(
        responses.map((r) => r.response),
        weights,
      ),
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

    const weights = await loadModelWeights();
    res.status(200).json({
      industryId: industry.id,
      industryName: industry.name,
      metric: metric.key,
      date: params.data.date,
      engine: engineKey,
      brands: averageTrends(rows, weights),
    });
    return;
  },
);

export default router;
