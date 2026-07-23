import { and, eq, desc, lt, inArray } from "drizzle-orm";
import {
  db,
  appSettingsTable,
  brandAlertsTable,
  industriesTable,
  surveyResponsesTable,
  surveyRunsTable,
  type SurveyRunRow,
  type StoredRankingEntry,
} from "@workspace/db";
import { METRICS, type MetricDef } from "./metrics";
import { averageEntries } from "./aggregate";
import { logger } from "./logger";
import { sendAlertDigestEmail, type AlertEmailItem } from "./alertEmail";

const SCORE_DROP_KEY = "alert_score_drop_threshold"; // points (0-100 scale)
const RANK_DROP_KEY = "alert_rank_drop_threshold"; // positions
const EMAIL_ENABLED_KEY = "alert_email_enabled";
const EMAIL_RECIPIENT_KEY = "alert_email_recipient";

export const DEFAULT_SCORE_DROP_THRESHOLD = 10;
export const DEFAULT_RANK_DROP_THRESHOLD = 2;

export interface AlertSettings {
  scoreDropThreshold: number;
  rankDropThreshold: number;
  emailEnabled: boolean;
  emailRecipient: string;
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

async function readStringSetting(key: string): Promise<string | null> {
  const [row] = await db
    .select()
    .from(appSettingsTable)
    .where(eq(appSettingsTable.key, key));
  return row?.value ?? null;
}

export async function getAlertSettings(): Promise<AlertSettings> {
  return {
    scoreDropThreshold:
      (await readNumberSetting(SCORE_DROP_KEY)) ?? DEFAULT_SCORE_DROP_THRESHOLD,
    rankDropThreshold:
      (await readNumberSetting(RANK_DROP_KEY)) ?? DEFAULT_RANK_DROP_THRESHOLD,
    emailEnabled: (await readStringSetting(EMAIL_ENABLED_KEY)) === "true",
    emailRecipient: (await readStringSetting(EMAIL_RECIPIENT_KEY)) ?? "",
  };
}

export async function setAlertSettings(
  settings: AlertSettings,
): Promise<AlertSettings> {
  const entries: [string, string][] = [
    [SCORE_DROP_KEY, String(settings.scoreDropThreshold)],
    [RANK_DROP_KEY, String(settings.rankDropThreshold)],
    [EMAIL_ENABLED_KEY, settings.emailEnabled ? "true" : "false"],
    [EMAIL_RECIPIENT_KEY, settings.emailRecipient.trim()],
  ];
  for (const [key, value] of entries) {
    await db
      .insert(appSettingsTable)
      .values({ key, value, updatedAt: new Date() })
      .onConflictDoUpdate({
        target: appSettingsTable.key,
        set: { value, updatedAt: new Date() },
      });
  }
  return getAlertSettings();
}

export interface DetectedAlert {
  brandId: number;
  brandName: string;
  metricKey: string;
  metricLabel: string;
  kind: "score_drop" | "rank_drop";
  previousValue: number;
  currentValue: number;
  delta: number;
  threshold: number;
}

/**
 * Pure delta logic: compare averaged current vs previous entries for one
 * (industry, metric) pair and return deterioration alerts.
 * - score_drop: the metric moved against the brand by >= scoreDropThreshold
 *   points (a decrease for higherIsBetter metrics, an increase for inverted
 *   metrics such as negative sentiment)
 * - rank_drop: the brand fell >= rankDropThreshold positions
 * Brands without a previous entry are skipped.
 */
export function computeAlertsForPair(
  current: StoredRankingEntry[],
  previous: StoredRankingEntry[],
  metric: Pick<MetricDef, "key" | "label" | "higherIsBetter">,
  settings: AlertSettings,
): DetectedAlert[] {
  const prevByBrand = new Map(previous.map((e) => [e.brandId, e]));
  const alerts: DetectedAlert[] = [];

  for (const entry of current) {
    const prev = prevByBrand.get(entry.brandId);
    if (!prev) continue;

    // Score deterioration: for higherIsBetter metrics that's a decrease;
    // for inverted metrics (e.g. negative sentiment) an increase is bad.
    const scoreDeterioration = metric.higherIsBetter
      ? prev.score - entry.score
      : entry.score - prev.score;
    if (scoreDeterioration >= settings.scoreDropThreshold) {
      alerts.push({
        brandId: entry.brandId,
        brandName: entry.brandName,
        metricKey: metric.key,
        metricLabel: metric.label,
        kind: "score_drop",
        previousValue: Math.round(prev.score * 10),
        currentValue: Math.round(entry.score * 10),
        delta: Math.round(scoreDeterioration * 10),
        threshold: Math.round(settings.scoreDropThreshold * 10),
      });
    }

    // Rank deterioration: rank number growing means the brand fell.
    const rankDeterioration = entry.rank - prev.rank;
    if (rankDeterioration >= settings.rankDropThreshold) {
      alerts.push({
        brandId: entry.brandId,
        brandName: entry.brandName,
        metricKey: metric.key,
        metricLabel: metric.label,
        kind: "rank_drop",
        previousValue: prev.rank,
        currentValue: entry.rank,
        delta: rankDeterioration,
        threshold: settings.rankDropThreshold,
      });
    }
  }

  return alerts;
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
  const emailItems: AlertEmailItem[] = [];

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

      const alerts = computeAlertsForPair(
        currentAvg,
        previousAvg,
        metric,
        settings,
      );
      for (const alert of alerts) {
        await db.insert(brandAlertsTable).values({
          runId: run.id,
          industryId,
          industryName: industry.name,
          ...alert,
        });
        created++;
        emailItems.push({
          brandName: alert.brandName,
          industryName: industry.name,
          metricLabel: alert.metricLabel,
          kind: alert.kind,
          previousValue:
            alert.kind === "score_drop"
              ? alert.previousValue / 10
              : alert.previousValue,
          currentValue:
            alert.kind === "score_drop"
              ? alert.currentValue / 10
              : alert.currentValue,
          delta: alert.kind === "score_drop" ? alert.delta / 10 : alert.delta,
        });
      }
    }
  }

  logger.info(
    { runId: run.id, alertsCreated: created, settings },
    "Alert detection completed",
  );

  if (created > 0 && settings.emailEnabled && settings.emailRecipient) {
    await sendAlertDigestEmail(settings.emailRecipient, run.id, emailItems);
  }

  return created;
}
