import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import {
  db,
  industriesTable,
  enginesTable,
  brandsTable,
  trendOutliersTable,
} from "@workspace/db";
import { METRICS } from "../lib/metrics";
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

/**
 * Per-brand analytics: the brand's standing on every metric plus a peer
 * ranking within its industry, in one call. Public (read-only), like the rest
 * of the industry endpoints. Mounted before the admin /brands gate.
 */
router.get("/brands/:brandId/analytics", async (req, res): Promise<void> => {
  const brandId = Number(req.params.brandId);
  if (!Number.isInteger(brandId) || brandId <= 0) {
    res.status(400).json({ message: "Invalid brand id" });
    return;
  }
  const [brand] = await db
    .select()
    .from(brandsTable)
    .where(eq(brandsTable.id, brandId));
  if (!brand) {
    res.status(404).json({ message: "Brand not found" });
    return;
  }
  const [industry] = await db
    .select()
    .from(industriesTable)
    .where(eq(industriesTable.id, brand.industryId));
  if (!industry) {
    res.status(404).json({ message: "Industry not found" });
    return;
  }

  const weights = await loadModelWeights();
  const metrics: {
    key: string;
    label: string;
    higherIsBetter: boolean;
    score: number | null;
    rank: number | null;
    totalBrands: number;
    previousRank: number | null;
  }[] = [];
  // Overall = average of a brand's metric scores across all metrics.
  const overall = new Map<number, { name: string; sum: number; count: number }>();

  for (const metric of METRICS) {
    const responses = await latestResponsesByEngine(industry.id, metric.key);
    const avg = averageEntries(
      responses.map((r) => r.response),
      metric.higherIsBetter,
      weights,
    );
    const snapshots = await runSnapshots(
      industry.id,
      metric.key,
      metric.higherIsBetter,
    );
    const prevSnap =
      snapshots.length >= 2 ? snapshots[snapshots.length - 2] : null;
    const prevRank = new Map(
      (prevSnap?.entries ?? []).map((e) => [e.brandId, e.rank]),
    );
    const mine = avg.find((e) => e.brandId === brandId);
    metrics.push({
      key: metric.key,
      label: metric.label,
      higherIsBetter: metric.higherIsBetter,
      score: mine?.score ?? null,
      rank: mine?.rank ?? null,
      totalBrands: avg.length,
      previousRank: prevRank.get(brandId) ?? null,
    });
    for (const e of avg) {
      const acc = overall.get(e.brandId);
      if (acc) {
        acc.sum += e.score;
        acc.count += 1;
      } else {
        overall.set(e.brandId, { name: e.brandName, sum: e.score, count: 1 });
      }
    }
  }

  const peers = [...overall.entries()]
    .map(([id, v]) => ({
      brandId: id,
      brandName: v.name,
      overallScore: Math.round((v.sum / v.count) * 10) / 10,
    }))
    .sort((a, b) => b.overallScore - a.overallScore)
    .map((p, i) => ({ ...p, rank: i + 1 }));
  const mineOverall = peers.find((p) => p.brandId === brandId);

  // Outlier markers for this brand (statistical ±Nσ points, with the engine's
  // explanation) — the chart renders these as clickable insight reference points.
  const engines = await db.select().from(enginesTable);
  const engineName = new Map(engines.map((e) => [e.id, e.name]));
  const outlierRows = await db
    .select()
    .from(trendOutliersTable)
    .where(eq(trendOutliersTable.brandId, brandId));
  const outliers = outlierRows
    .sort((a, b) => a.measuredAt.getTime() - b.measuredAt.getTime())
    .map((o) => ({
      id: o.id,
      metricKey: o.metricKey,
      metricLabel: getMetric(o.metricKey)?.label ?? o.metricKey,
      engineId: o.engineId,
      engineName: engineName.get(o.engineId) ?? `Engine ${o.engineId}`,
      value: o.value,
      mean: o.mean,
      sigma: o.sigma,
      direction: o.direction,
      measuredAt: o.measuredAt.toISOString(),
      explanation: o.explanation,
      explanationModel: o.explanationModel,
    }));

  res.status(200).json({
    brand: {
      id: brand.id,
      name: brand.name,
      industryId: industry.id,
      industryName: industry.name,
    },
    overallScore: mineOverall?.overallScore ?? null,
    overallRank: mineOverall?.rank ?? null,
    peerCount: peers.length,
    metrics,
    peers,
    outliers,
  });
  return;
});

export default router;
