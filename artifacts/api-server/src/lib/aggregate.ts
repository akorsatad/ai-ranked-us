import { and, eq, desc, inArray } from "drizzle-orm";
import {
  db,
  enginesTable,
  engineModelsTable,
  surveyResponsesTable,
  surveyRunsTable,
  type EngineRow,
  type SurveyResponseRow,
  type StoredRankingEntry,
  type StoredBrandTrend,
} from "@workspace/db";

/** engineModelId → configured weight. Enabled models only. */
export type ModelWeights = Map<number, number>;

/**
 * Load per-model weights so aggregation can blend an engine's models. Read at
 * query time, so retuning weights in admin recomputes all history without a
 * re-survey. Missing/legacy (null) model ids default to weight 1.
 */
export async function loadModelWeights(): Promise<ModelWeights> {
  const rows = await db
    .select({
      id: engineModelsTable.id,
      weight: engineModelsTable.weight,
      enabled: engineModelsTable.enabled,
    })
    .from(engineModelsTable);
  const map: ModelWeights = new Map();
  for (const r of rows) {
    if (!r.enabled) continue;
    map.set(r.id, r.weight > 0 ? r.weight : 0);
  }
  return map;
}

function weightOf(
  engineModelId: number | null,
  weights?: ModelWeights,
): number {
  if (engineModelId == null) return 1; // legacy/single implicit model
  return weights?.get(engineModelId) ?? 1;
}

/**
 * The two survey queries are stored as separate rows tagged by query_type.
 * "combined" is the legacy single-call shape (imported/historical rows) that
 * carries both rankings and trend, so it belongs to both sets.
 */
export const RANKING_QUERY_TYPES = ["current", "combined"];
export const TREND_QUERY_TYPES = ["trend", "combined"];

/**
 * Latest successful response per (engine, model) for an (industry, metric)
 * pair, plus that group's previous successful response. With model-level
 * querying there can be several rows per engine (one per model); callers that
 * want engine-level numbers pass these through `averageEntries`/`averageTrends`
 * (or `mergePerEngine`), which blend an engine's models by weight.
 */
export async function latestResponsesByEngine(
  industryId: number,
  metricKey: string,
  carrying: "ranking" | "trend" = "ranking",
): Promise<
  {
    engine: EngineRow;
    engineModelId: number | null;
    response: SurveyResponseRow;
    previousResponse: SurveyResponseRow | null;
  }[]
> {
  const queryTypes =
    carrying === "trend" ? TREND_QUERY_TYPES : RANKING_QUERY_TYPES;
  const engines = await db.select().from(enginesTable);
  const engineById = new Map(engines.map((e) => [e.id, e]));
  const rows = await db
    .select()
    .from(surveyResponsesTable)
    .where(
      and(
        eq(surveyResponsesTable.industryId, industryId),
        eq(surveyResponsesTable.metricKey, metricKey),
        eq(surveyResponsesTable.status, "ok"),
        inArray(surveyResponsesTable.queryType, queryTypes),
      ),
    )
    .orderBy(desc(surveyResponsesTable.createdAt));

  // Group by (engine, model); rows are newest-first so [0]=latest, [1]=previous.
  const byGroup = new Map<
    string,
    { latest: SurveyResponseRow; previous: SurveyResponseRow | null }
  >();
  for (const r of rows) {
    const key = `${r.engineId}:${r.engineModelId ?? ""}`;
    const g = byGroup.get(key);
    if (!g) byGroup.set(key, { latest: r, previous: null });
    else if (!g.previous) g.previous = r;
  }

  const results: {
    engine: EngineRow;
    engineModelId: number | null;
    response: SurveyResponseRow;
    previousResponse: SurveyResponseRow | null;
  }[] = [];
  for (const g of byGroup.values()) {
    const engine = engineById.get(g.latest.engineId);
    if (!engine) continue;
    results.push({
      engine,
      engineModelId: g.latest.engineModelId ?? null,
      response: g.latest,
      previousResponse: g.previous,
    });
  }
  return results;
}

/**
 * Re-rank entries so rank 1 = best brand on the metric.
 * For higherIsBetter metrics the highest score wins; for inverted metrics
 * (e.g. negative sentiment) the LOWEST score wins.
 */
export function rankEntries(
  entries: StoredRankingEntry[],
  higherIsBetter: boolean,
): StoredRankingEntry[] {
  const sorted = [...entries].sort((a, b) =>
    higherIsBetter ? b.score - a.score : a.score - b.score,
  );
  return sorted.map((entry, i) => ({ ...entry, rank: i + 1 }));
}

/**
 * Two-level per-brand average with model weighting:
 *   1. within each engine, blend its models by weight (normalized to the models
 *      actually present), so an engine querying 2 models still counts as one
 *      "voice" — not double;
 *   2. average those engine-level scores equally across engines.
 * Re-ranks so rank 1 = best brand on the metric (see rankEntries). Passing no
 * weights (or legacy null model ids) makes every model weight 1.
 */
export function averageEntries(
  responses: SurveyResponseRow[],
  higherIsBetter: boolean,
  weights?: ModelWeights,
): StoredRankingEntry[] {
  // engineId → brandId → weighted accumulation across that engine's models
  const byEngine = new Map<
    number,
    Map<
      number,
      { brandName: string; wScore: number; wSum: number; rationale: string | null }
    >
  >();
  for (const response of responses) {
    const w = weightOf(response.engineModelId, weights);
    if (w <= 0) continue;
    let brands = byEngine.get(response.engineId);
    if (!brands) {
      brands = new Map();
      byEngine.set(response.engineId, brands);
    }
    for (const entry of response.entries ?? []) {
      const acc = brands.get(entry.brandId);
      if (acc) {
        acc.wScore += entry.score * w;
        acc.wSum += w;
        if (!acc.rationale && entry.rationale) acc.rationale = entry.rationale;
      } else {
        brands.set(entry.brandId, {
          brandName: entry.brandName,
          wScore: entry.score * w,
          wSum: w,
          rationale: entry.rationale,
        });
      }
    }
  }

  const byBrand = new Map<
    number,
    { brandName: string; total: number; count: number; rationale: string | null }
  >();
  for (const brands of byEngine.values()) {
    for (const [brandId, acc] of brands) {
      if (acc.wSum <= 0) continue;
      const engineScore = acc.wScore / acc.wSum;
      const b = byBrand.get(brandId);
      if (b) {
        b.total += engineScore;
        b.count += 1;
        if (!b.rationale && acc.rationale) b.rationale = acc.rationale;
      } else {
        byBrand.set(brandId, {
          brandName: acc.brandName,
          total: engineScore,
          count: 1,
          rationale: acc.rationale,
        });
      }
    }
  }
  const averaged = [...byBrand.entries()].map(([brandId, v]) => ({
    brandId,
    brandName: v.brandName,
    rank: 0,
    score: Math.round((v.total / v.count) * 10) / 10,
    rationale: v.rationale,
  }));
  return rankEntries(averaged, higherIsBetter);
}

export interface RunSnapshot {
  runId: number;
  /** ISO timestamp of the latest response in the run for this pair */
  date: string;
  entries: StoredRankingEntry[];
}

/**
 * Per-run averaged + ranked snapshots for an (industry, metric) pair,
 * oldest run first. Each snapshot averages ok responses across engines
 * within that run.
 */
export async function runSnapshots(
  industryId: number,
  metricKey: string,
  higherIsBetter: boolean,
): Promise<RunSnapshot[]> {
  const responses = await db
    .select()
    .from(surveyResponsesTable)
    .where(
      and(
        eq(surveyResponsesTable.industryId, industryId),
        eq(surveyResponsesTable.metricKey, metricKey),
        eq(surveyResponsesTable.status, "ok"),
        inArray(surveyResponsesTable.queryType, RANKING_QUERY_TYPES),
      ),
    );
  if (responses.length === 0) return [];

  const byRun = new Map<number, SurveyResponseRow[]>();
  for (const response of responses) {
    const list = byRun.get(response.runId);
    if (list) list.push(response);
    else byRun.set(response.runId, [response]);
  }

  const runIds = [...byRun.keys()];
  const runs = await db
    .select()
    .from(surveyRunsTable)
    .where(inArray(surveyRunsTable.id, runIds));
  const runStart = new Map(runs.map((r) => [r.id, r.startedAt.getTime()]));

  return runIds
    .sort((a, b) => (runStart.get(a) ?? 0) - (runStart.get(b) ?? 0))
    .map((runId) => {
      const runResponses = byRun.get(runId)!;
      const latest = runResponses.reduce((max, r) =>
        r.createdAt > max.createdAt ? r : max,
      );
      return {
        runId,
        date: latest.createdAt.toISOString(),
        entries: averageEntries(runResponses, higherIsBetter),
      };
    });
}

export interface MoverComputation {
  brandId: number;
  brandName: string;
  previousRank: number;
  currentRank: number;
  rankDelta: number;
  previousScore: number;
  currentScore: number;
  scoreDelta: number;
}

/**
 * Compare the two most recent run snapshots and compute per-brand movement.
 * rankDelta > 0 means the brand moved UP (improved rank).
 */
export function computeMovers(
  previous: RunSnapshot,
  current: RunSnapshot,
): MoverComputation[] {
  const prevByBrand = new Map(previous.entries.map((e) => [e.brandId, e]));
  const movers: MoverComputation[] = [];
  for (const entry of current.entries) {
    const prev = prevByBrand.get(entry.brandId);
    if (!prev) continue;
    movers.push({
      brandId: entry.brandId,
      brandName: entry.brandName,
      previousRank: prev.rank,
      currentRank: entry.rank,
      rankDelta: prev.rank - entry.rank,
      previousScore: prev.score,
      currentScore: entry.score,
      scoreDelta: Math.round((entry.score - prev.score) * 10) / 10,
    });
  }
  return movers;
}

/**
 * Two-level per-brand trend average with model weighting: within each engine,
 * blend its models by weight per week; then average engine-level weekly scores
 * across engines. Mirrors `averageEntries` so measured and estimated series sit
 * on the same weighting.
 */
export function averageTrends(
  responses: {
    engineId: number;
    engineModelId: number | null;
    trend: StoredBrandTrend[] | null;
  }[],
  weights?: ModelWeights,
): StoredBrandTrend[] {
  // engineId → brandId → weighted weekly accumulation across the engine's models
  const byEngine = new Map<
    number,
    Map<
      number,
      { brandName: string; wTotals: number[]; wSums: number[]; labels: string[] }
    >
  >();
  for (const response of responses) {
    const w = weightOf(response.engineModelId, weights);
    if (w <= 0) continue;
    let brands = byEngine.get(response.engineId);
    if (!brands) {
      brands = new Map();
      byEngine.set(response.engineId, brands);
    }
    for (const brandTrend of response.trend ?? []) {
      let acc = brands.get(brandTrend.brandId);
      if (!acc) {
        acc = {
          brandName: brandTrend.brandName,
          wTotals: new Array(13).fill(0),
          wSums: new Array(13).fill(0),
          labels: new Array(13).fill(""),
        };
        brands.set(brandTrend.brandId, acc);
      }
      for (const point of brandTrend.points) {
        if (point.weekIndex < 0 || point.weekIndex > 12) continue;
        acc.wTotals[point.weekIndex]! += point.score * w;
        acc.wSums[point.weekIndex]! += w;
        if (!acc.labels[point.weekIndex]) {
          acc.labels[point.weekIndex] = point.weekLabel;
        }
      }
    }
  }

  const byBrand = new Map<
    number,
    { brandName: string; totals: number[]; counts: number[]; labels: string[] }
  >();
  for (const brands of byEngine.values()) {
    for (const [brandId, acc] of brands) {
      let b = byBrand.get(brandId);
      if (!b) {
        b = {
          brandName: acc.brandName,
          totals: new Array(13).fill(0),
          counts: new Array(13).fill(0),
          labels: new Array(13).fill(""),
        };
        byBrand.set(brandId, b);
      }
      for (let i = 0; i < 13; i++) {
        if (acc.wSums[i]! > 0) {
          b.totals[i]! += acc.wTotals[i]! / acc.wSums[i]!;
          b.counts[i]! += 1;
          if (!b.labels[i]) b.labels[i] = acc.labels[i]!;
        }
      }
    }
  }
  return [...byBrand.entries()].map(([brandId, acc]) => ({
    brandId,
    brandName: acc.brandName,
    points: acc.totals
      .map((total, i) => ({
        weekIndex: i,
        weekLabel: acc.labels[i] || `W${i}`,
        score:
          acc.counts[i]! > 0
            ? Math.round((total / acc.counts[i]!) * 10) / 10
            : 0,
      }))
      .filter((_, i) => acc.counts[i]! > 0),
  }));
}
