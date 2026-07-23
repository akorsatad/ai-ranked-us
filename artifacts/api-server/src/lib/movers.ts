import type {
  IndustryRow,
  SurveyRunRow,
  SurveyResponseRow,
} from "@workspace/db";
import { averageEntries, computeMovers } from "./aggregate";

export interface MetricDef {
  key: string;
  label: string;
  higherIsBetter: boolean;
}

export interface MoverDto {
  industryId: number;
  industryName: string;
  metric: string;
  metricLabel: string;
  brandId: number;
  brandName: string;
  previousRank: number;
  currentRank: number;
  rankDelta: number;
  previousScore: number;
  currentScore: number;
  scoreDelta: number;
}

export interface MoversReportDto {
  latestRunId: number | null;
  previousRunId: number | null;
  latestRunAt: string | null;
  previousRunAt: string | null;
  movers: MoverDto[];
}

/**
 * Build the movers report anchored on a single global run pair.
 * Only industry/metric pairs with ok responses in BOTH runs are compared;
 * pairs missing from either run are excluded (never backfilled from older
 * runs), so every mover reflects the same latest-vs-previous comparison.
 */
export function buildMoversReport(input: {
  latestRun: SurveyRunRow;
  previousRun: SurveyRunRow;
  /** ok responses belonging to latestRun or previousRun only */
  responses: SurveyResponseRow[];
  industries: IndustryRow[];
  metrics: MetricDef[];
}): MoversReportDto {
  const { latestRun, previousRun, responses, industries, metrics } = input;
  const industryName = new Map(industries.map((i) => [i.id, i.name]));

  // Group responses by (industryId, metricKey, runId)
  const groups = new Map<string, SurveyResponseRow[]>();
  for (const response of responses) {
    if (response.runId !== latestRun.id && response.runId !== previousRun.id) {
      continue;
    }
    const key = `${response.industryId}|${response.metricKey}|${response.runId}`;
    const list = groups.get(key);
    if (list) list.push(response);
    else groups.set(key, [response]);
  }

  const movers: MoverDto[] = [];
  for (const industry of industries) {
    for (const metric of metrics) {
      const current = groups.get(
        `${industry.id}|${metric.key}|${latestRun.id}`,
      );
      const previous = groups.get(
        `${industry.id}|${metric.key}|${previousRun.id}`,
      );
      // Require data in BOTH runs — otherwise skip (no stale comparisons).
      if (!current || !previous) continue;
      const computed = computeMovers(
        {
          runId: previousRun.id,
          date: previousRun.startedAt.toISOString(),
          entries: averageEntries(previous, metric.higherIsBetter),
        },
        {
          runId: latestRun.id,
          date: latestRun.startedAt.toISOString(),
          entries: averageEntries(current, metric.higherIsBetter),
        },
      );
      for (const mover of computed) {
        if (mover.rankDelta === 0 && mover.scoreDelta === 0) continue;
        movers.push({
          industryId: industry.id,
          industryName: industryName.get(industry.id) ?? "",
          metric: metric.key,
          metricLabel: metric.label,
          ...mover,
        });
      }
    }
  }

  movers.sort(
    (a, b) =>
      Math.abs(b.rankDelta) - Math.abs(a.rankDelta) ||
      Math.abs(b.scoreDelta) - Math.abs(a.scoreDelta),
  );

  return {
    latestRunId: latestRun.id,
    previousRunId: previousRun.id,
    latestRunAt: latestRun.startedAt.toISOString(),
    previousRunAt: previousRun.startedAt.toISOString(),
    movers,
  };
}
