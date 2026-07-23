import { and, eq, desc } from "drizzle-orm";
import {
  db,
  enginesTable,
  surveyResponsesTable,
  type EngineRow,
  type SurveyResponseRow,
  type StoredRankingEntry,
  type StoredBrandTrend,
} from "@workspace/db";

/**
 * Latest successful response per engine for an (industry, metric) pair.
 */
export async function latestResponsesByEngine(
  industryId: number,
  metricKey: string,
): Promise<{ engine: EngineRow; response: SurveyResponseRow }[]> {
  const engines = await db.select().from(enginesTable);
  const results: { engine: EngineRow; response: SurveyResponseRow }[] = [];
  for (const engine of engines) {
    const [response] = await db
      .select()
      .from(surveyResponsesTable)
      .where(
        and(
          eq(surveyResponsesTable.industryId, industryId),
          eq(surveyResponsesTable.metricKey, metricKey),
          eq(surveyResponsesTable.engineId, engine.id),
          eq(surveyResponsesTable.status, "ok"),
        ),
      )
      .orderBy(desc(surveyResponsesTable.createdAt))
      .limit(1);
    if (response) results.push({ engine, response });
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
 * Average per-brand scores across engine responses and re-rank so that
 * rank 1 = best brand on the metric (see rankEntries).
 */
export function averageEntries(
  responses: SurveyResponseRow[],
  higherIsBetter: boolean,
): StoredRankingEntry[] {
  const byBrand = new Map<
    number,
    { brandName: string; total: number; count: number; rationale: string | null }
  >();
  for (const response of responses) {
    for (const entry of response.entries ?? []) {
      const existing = byBrand.get(entry.brandId);
      if (existing) {
        existing.total += entry.score;
        existing.count += 1;
        if (!existing.rationale && entry.rationale) {
          existing.rationale = entry.rationale;
        }
      } else {
        byBrand.set(entry.brandId, {
          brandName: entry.brandName,
          total: entry.score,
          count: 1,
          rationale: entry.rationale,
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

/**
 * Average trend points across engine responses per brand.
 */
export function averageTrends(
  responses: SurveyResponseRow[],
): StoredBrandTrend[] {
  const byBrand = new Map<
    number,
    {
      brandName: string;
      totals: number[];
      counts: number[];
      labels: string[];
    }
  >();
  for (const response of responses) {
    for (const brandTrend of response.trend ?? []) {
      let acc = byBrand.get(brandTrend.brandId);
      if (!acc) {
        acc = {
          brandName: brandTrend.brandName,
          totals: new Array(13).fill(0),
          counts: new Array(13).fill(0),
          labels: new Array(13).fill(""),
        };
        byBrand.set(brandTrend.brandId, acc);
      }
      for (const point of brandTrend.points) {
        if (point.weekIndex < 0 || point.weekIndex > 12) continue;
        acc.totals[point.weekIndex]! += point.score;
        acc.counts[point.weekIndex]! += 1;
        if (!acc.labels[point.weekIndex]) {
          acc.labels[point.weekIndex] = point.weekLabel;
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
