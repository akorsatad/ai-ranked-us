import { and, eq, desc, lt, inArray } from "drizzle-orm";
import {
  db,
  appSettingsTable,
  brandAlertsTable,
  industriesTable,
  surveyResponsesTable,
  surveyRunsTable,
  type SurveyRunRow,
} from "@workspace/db";
import { METRICS } from "./metrics";
import { averageEntries } from "./aggregate";
import { logger } from "./logger";

const SCORE_DROP_KEY = "alert_score_drop_threshold"; // points (0-100 scale)
const RANK_DROP_KEY = "alert_rank_drop_threshold"; // positions

export const DEFAULT_SCORE_DROP_THRESHOLD = 10;
export const DEFAULT_RANK_DROP_THRESHOLD = 2;

export interface AlertSettings {
  scoreDropThreshold: number;
  rankDropThreshold: number;
}

async function readNumberSetting(key: string): Promise<number | null> {
  const [row] = await db
    .select()
    .from(appSettingsTable)
    .where(eq(appSettingsTable.key, key));
  if (!row) return null;
  const value = Number(row.value);
  return Number.isFinite(value) ? value : null;
}

export async function getAlertSettings(): Promise<AlertSettings> {
  return {
    scoreDropThreshold:
      (await readNumberSetting(SCORE_DROP_KEY)) ?? DEFAULT_SCORE_DROP_THRESHOLD,
    rankDropThreshold:
      (await readNumberSetting(RANK_DROP_KEY)) ?? DEFAULT_RANK_DROP_THRESHOLD,
  };
}

export async function setAlertSettings(
  settings: AlertSettings,
): Promise<AlertSettings> {
  const entries: [string, number][] = [
    [SCORE_DROP_KEY, settings.scoreDropThreshold],
    [RANK_DROP_KEY, settings.rankDropThreshold],
  ];
  for (const [key, value] of entries) {
    await db
      .insert(appSettingsTable)
      .values({ key, value: String(value), updatedAt: new Date() })
      .onConflictDoUpdate({
        target: appSettingsTable.key,
        set: { value: String(value), updatedAt: new Date() },
      });
  }
  return getAlertSettings();
}

/**
 * Compare this run's averaged results against the previous run's, per
 * (industry, metric, brand), and record alerts for sharp deteriorations:
 * - score_drop: the metric moved against the brand by >= scoreDropThreshold points
 * - rank_drop: the brand fell >= rankDropThreshold positions in the ranking
 */
export async function detectAlertsForRun(run: SurveyRunRow): Promise<number> {
  const settings = await getAlertSettings();

  // Previous completed runs (any status with responses), newest first.
  const previousRuns = await db
    .select({ id: surveyRunsTable.id })
    .from(surveyRunsTable)
    .where(lt(surveyRunsTable.id, run.id))
    .orderBy(desc(surveyRunsTable.id));
  if (previousRuns.length === 0) return 0;
  const previousRunIds = previousRuns.map((r) => r.id);

  const industries = await db.select().from(industriesTable);
  const industryById = new Map(industries.map((i) => [i.id, i]));

  const currentResponses = await db
    .select()
    .from(surveyResponsesTable)
    .where(
      and(
        eq(surveyResponsesTable.runId, run.id),
        eq(surveyResponsesTable.status, "ok"),
      ),
    );

  let created = 0;

  for (const metric of METRICS) {
    const industryIds = [
      ...new Set(
        currentResponses
          .filter((r) => r.metricKey === metric.key)
          .map((r) => r.industryId),
      ),
    ];
    for (const industryId of industryIds) {
      const industry = industryById.get(industryId);
      if (!industry) continue;

      const current = currentResponses.filter(
        (r) => r.metricKey === metric.key && r.industryId === industryId,
      );

      // Most recent previous run that has ok responses for this pair.
      const prevCandidates = await db
        .select()
        .from(surveyResponsesTable)
        .where(
          and(
            inArray(surveyResponsesTable.runId, previousRunIds),
            eq(surveyResponsesTable.metricKey, metric.key),
            eq(surveyResponsesTable.industryId, industryId),
            eq(surveyResponsesTable.status, "ok"),
          ),
        )
        .orderBy(desc(surveyResponsesTable.runId));
      if (prevCandidates.length === 0) continue;
      const prevRunId = prevCandidates[0]!.runId;
      const previous = prevCandidates.filter((r) => r.runId === prevRunId);

      const currentAvg = averageEntries(current, metric.higherIsBetter);
      const previousAvg = averageEntries(previous, metric.higherIsBetter);
      const prevByBrand = new Map(previousAvg.map((e) => [e.brandId, e]));

      for (const entry of currentAvg) {
        const prev = prevByBrand.get(entry.brandId);
        if (!prev) continue;

        // Score deterioration: for higherIsBetter metrics that's a decrease;
        // for inverted metrics (e.g. negative sentiment) an increase is bad.
        const scoreDeterioration = metric.higherIsBetter
          ? prev.score - entry.score
          : entry.score - prev.score;
        if (scoreDeterioration >= settings.scoreDropThreshold) {
          await db.insert(brandAlertsTable).values({
            runId: run.id,
            brandId: entry.brandId,
            brandName: entry.brandName,
            industryId,
            industryName: industry.name,
            metricKey: metric.key,
            metricLabel: metric.label,
            kind: "score_drop",
            previousValue: Math.round(prev.score * 10),
            currentValue: Math.round(entry.score * 10),
            delta: Math.round(scoreDeterioration * 10),
            threshold: Math.round(settings.scoreDropThreshold * 10),
          });
          created++;
        }

        // Rank deterioration: rank number growing means the brand fell.
        const rankDeterioration = entry.rank - prev.rank;
        if (rankDeterioration >= settings.rankDropThreshold) {
          await db.insert(brandAlertsTable).values({
            runId: run.id,
            brandId: entry.brandId,
            brandName: entry.brandName,
            industryId,
            industryName: industry.name,
            metricKey: metric.key,
            metricLabel: metric.label,
            kind: "rank_drop",
            previousValue: prev.rank,
            currentValue: entry.rank,
            delta: rankDeterioration,
            threshold: settings.rankDropThreshold,
          });
          created++;
        }
      }
    }
  }

  logger.info(
    { runId: run.id, alertsCreated: created, settings },
    "Alert detection completed",
  );
  return created;
}
