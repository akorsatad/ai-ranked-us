import { eq, notInArray, and } from "drizzle-orm";
import {
  db,
  dailyMeasurementsTable,
  trendSnapshotsTable,
  surveyResponsesTable,
  type SurveyResponseRow,
} from "@workspace/db";
import { loadModelWeights, type ModelWeights } from "./aggregate";
import { logger } from "./logger";

function modelWeight(
  engineModelId: number | null,
  weights: ModelWeights,
): number {
  if (engineModelId == null) return 1;
  return weights.get(engineModelId) ?? 1;
}

function toDateKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/**
 * Record the structured daily-measurement rows and 13-week trend snapshot
 * for a successful survey response. Idempotent per response.
 */
export async function recordSeriesForResponse(
  response: SurveyResponseRow,
): Promise<void> {
  if (response.status !== "ok") return;

  const entries = response.entries ?? [];
  if (entries.length > 0) {
    await db
      .insert(dailyMeasurementsTable)
      .values(
        entries.map((entry) => ({
          responseId: response.id,
          runId: response.runId,
          engineId: response.engineId,
          engineModelId: response.engineModelId,
          industryId: response.industryId,
          metricKey: response.metricKey,
          brandId: entry.brandId,
          brandName: entry.brandName,
          rank: entry.rank,
          scoreX10: Math.round(entry.score * 10),
          measuredAt: response.createdAt,
        })),
      )
      .onConflictDoNothing();
  }

  const trend = response.trend ?? [];
  if (trend.length > 0) {
    await db
      .insert(trendSnapshotsTable)
      .values({
        responseId: response.id,
        runId: response.runId,
        engineId: response.engineId,
        engineModelId: response.engineModelId,
        industryId: response.industryId,
        metricKey: response.metricKey,
        snapshotDate: toDateKey(response.createdAt),
        trend,
      })
      .onConflictDoNothing();
  }
}

/**
 * Backfill the structured series tables from historical survey_responses
 * rows that have not been recorded yet. Safe to run repeatedly.
 */
export async function backfillSeries(): Promise<void> {
  const measuredIds = (
    await db
      .select({ responseId: dailyMeasurementsTable.responseId })
      .from(dailyMeasurementsTable)
  ).map((r) => r.responseId);
  const snapshotIds = (
    await db
      .select({ responseId: trendSnapshotsTable.responseId })
      .from(trendSnapshotsTable)
  ).map((r) => r.responseId);
  const doneIds = [...new Set([...measuredIds, ...snapshotIds])].filter(
    (id) => measuredIds.includes(id) && snapshotIds.includes(id),
  );

  const pending = await db
    .select()
    .from(surveyResponsesTable)
    .where(
      doneIds.length > 0
        ? and(
            eq(surveyResponsesTable.status, "ok"),
            notInArray(surveyResponsesTable.id, doneIds),
          )
        : eq(surveyResponsesTable.status, "ok"),
    );

  if (pending.length === 0) return;
  for (const response of pending) {
    await recordSeriesForResponse(response);
  }
  logger.info(
    { backfilled: pending.length },
    "Backfilled measurement/trend series from historical responses",
  );
}

export interface MeasuredPoint {
  runId: number;
  date: string;
  score: number;
  rank: number;
}

export interface MeasuredBrandSeries {
  brandId: number;
  brandName: string;
  points: MeasuredPoint[];
}

/**
 * Measured daily series from the structured table, averaged across engines
 * per run (or filtered to a single engine).
 */
export async function measuredSeries(
  industryId: number,
  metricKey: string,
  engineId?: number,
): Promise<{ series: MeasuredBrandSeries[]; runsCount: number }> {
  const conditions = [
    eq(dailyMeasurementsTable.industryId, industryId),
    eq(dailyMeasurementsTable.metricKey, metricKey),
  ];
  if (engineId != null) {
    conditions.push(eq(dailyMeasurementsTable.engineId, engineId));
  }
  const rows = await db
    .select()
    .from(dailyMeasurementsTable)
    .where(and(...conditions));
  const weights = await loadModelWeights();

  // Two-level per run: within each engine blend its models by weight, then
  // average engines equally — the same weighting the estimated/ranking series
  // use, so measured and 12-week estimate stay comparable.
  // run → brand → engine → weighted accumulation
  const byRun = new Map<
    number,
    {
      date: Date;
      brands: Map<
        number,
        {
          brandName: string;
          engines: Map<
            number,
            { wScore: number; wSum: number; wRank: number }
          >;
        }
      >;
    }
  >();
  for (const row of rows) {
    let run = byRun.get(row.runId);
    if (!run) {
      run = { date: row.measuredAt, brands: new Map() };
      byRun.set(row.runId, run);
    }
    if (row.measuredAt > run.date) run.date = row.measuredAt;
    let brand = run.brands.get(row.brandId);
    if (!brand) {
      brand = { brandName: row.brandName, engines: new Map() };
      run.brands.set(row.brandId, brand);
    }
    const w = modelWeight(row.engineModelId, weights);
    if (w <= 0) continue;
    const eng = brand.engines.get(row.engineId);
    if (eng) {
      eng.wScore += (row.scoreX10 / 10) * w;
      eng.wRank += row.rank * w;
      eng.wSum += w;
    } else {
      brand.engines.set(row.engineId, {
        wScore: (row.scoreX10 / 10) * w,
        wRank: row.rank * w,
        wSum: w,
      });
    }
  }

  const runIds = [...byRun.keys()].sort(
    (a, b) => byRun.get(a)!.date.getTime() - byRun.get(b)!.date.getTime(),
  );
  const byBrand = new Map<number, MeasuredBrandSeries>();
  for (const runId of runIds) {
    const run = byRun.get(runId)!;
    for (const [brandId, brand] of run.brands) {
      // Collapse each engine's models (weighted), then average engines equally.
      let scoreSum = 0;
      let rankSum = 0;
      let engineCount = 0;
      for (const eng of brand.engines.values()) {
        if (eng.wSum <= 0) continue;
        scoreSum += eng.wScore / eng.wSum;
        rankSum += eng.wRank / eng.wSum;
        engineCount += 1;
      }
      if (engineCount === 0) continue;
      let series = byBrand.get(brandId);
      if (!series) {
        series = { brandId, brandName: brand.brandName, points: [] };
        byBrand.set(brandId, series);
      }
      series.points.push({
        runId,
        date: run.date.toISOString(),
        score: Math.round((scoreSum / engineCount) * 10) / 10,
        rank: Math.round(rankSum / engineCount),
      });
    }
  }
  return { series: [...byBrand.values()], runsCount: runIds.length };
}

/**
 * Distinct snapshot dates available for an (industry, metric) pair,
 * newest first, with the runs contributing to each date.
 */
export async function listSnapshotDates(
  industryId: number,
  metricKey: string,
  engineId?: number,
): Promise<{ date: string; runIds: number[]; enginesCount: number }[]> {
  const conditions = [
    eq(trendSnapshotsTable.industryId, industryId),
    eq(trendSnapshotsTable.metricKey, metricKey),
  ];
  if (engineId != null) {
    conditions.push(eq(trendSnapshotsTable.engineId, engineId));
  }
  const rows = await db
    .select({
      snapshotDate: trendSnapshotsTable.snapshotDate,
      runId: trendSnapshotsTable.runId,
      engineId: trendSnapshotsTable.engineId,
    })
    .from(trendSnapshotsTable)
    .where(and(...conditions));

  const byDate = new Map<string, { runIds: Set<number>; engines: Set<number> }>();
  for (const row of rows) {
    let acc = byDate.get(row.snapshotDate);
    if (!acc) {
      acc = { runIds: new Set(), engines: new Set() };
      byDate.set(row.snapshotDate, acc);
    }
    acc.runIds.add(row.runId);
    acc.engines.add(row.engineId);
  }
  return [...byDate.entries()]
    .sort((a, b) => (a[0] < b[0] ? 1 : -1))
    .map(([date, acc]) => ({
      date,
      runIds: [...acc.runIds].sort((a, b) => a - b),
      enginesCount: acc.engines.size,
    }));
}

/**
 * Snapshot rows for a specific date (latest per engine on that date).
 */
export async function snapshotsForDate(
  industryId: number,
  metricKey: string,
  date: string,
  engineId?: number,
) {
  const conditions = [
    eq(trendSnapshotsTable.industryId, industryId),
    eq(trendSnapshotsTable.metricKey, metricKey),
    eq(trendSnapshotsTable.snapshotDate, date),
  ];
  if (engineId != null) {
    conditions.push(eq(trendSnapshotsTable.engineId, engineId));
  }
  const rows = await db
    .select()
    .from(trendSnapshotsTable)
    .where(and(...conditions));

  // Keep only the latest snapshot per (engine, model) for the date, so every
  // model feeds the weighted trend blend.
  const byGroup = new Map<string, (typeof rows)[number]>();
  for (const row of rows) {
    const key = `${row.engineId}:${row.engineModelId ?? ""}`;
    const existing = byGroup.get(key);
    if (!existing || row.createdAt > existing.createdAt) {
      byGroup.set(key, row);
    }
  }
  return [...byGroup.values()];
}
