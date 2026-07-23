import { describe, it, expect } from "vitest";
import { buildMoversReport } from "./movers";
import type { SurveyRunRow, SurveyResponseRow, IndustryRow } from "@workspace/db";

const run = (id: number, startedAt: string): SurveyRunRow =>
  ({
    id,
    status: "completed",
    trigger: "manual",
    startedAt: new Date(startedAt),
    completedAt: new Date(startedAt),
    error: null,
    totalQueries: 0,
    succeededQueries: 0,
    failedQueries: 0,
  }) as SurveyRunRow;

const response = (
  runId: number,
  industryId: number,
  metricKey: string,
  entries: { brandId: number; brandName: string; score: number }[],
): SurveyResponseRow =>
  ({
    id: Math.random(),
    runId,
    engineId: 1,
    industryId,
    metricKey,
    status: "ok",
    error: null,
    entries: entries.map((e) => ({ ...e, rank: 0, rationale: null })),
    trend: null,
    createdAt: new Date(),
  }) as SurveyResponseRow;

const industries: IndustryRow[] = [
  { id: 1, name: "Banking", slug: "banking", country: "US" } as IndustryRow,
  { id: 2, name: "Airlines", slug: "airlines", country: "US" } as IndustryRow,
];
const metrics = [
  { key: "positive_sentiment", label: "Positive Sentiment", higherIsBetter: true },
];

describe("buildMoversReport", () => {
  const previousRun = run(1, "2026-07-22T00:00:00Z");
  const latestRun = run(2, "2026-07-23T00:00:00Z");

  it("computes rank and score deltas between the anchored run pair", () => {
    const report = buildMoversReport({
      latestRun,
      previousRun,
      responses: [
        response(1, 1, "positive_sentiment", [
          { brandId: 10, brandName: "A", score: 80 },
          { brandId: 11, brandName: "B", score: 70 },
        ]),
        response(2, 1, "positive_sentiment", [
          { brandId: 10, brandName: "A", score: 60 },
          { brandId: 11, brandName: "B", score: 75 },
        ]),
      ],
      industries,
      metrics,
    });
    expect(report.latestRunId).toBe(2);
    expect(report.previousRunId).toBe(1);
    const b = report.movers.find((m) => m.brandId === 11)!;
    expect(b.previousRank).toBe(2);
    expect(b.currentRank).toBe(1);
    expect(b.rankDelta).toBe(1);
    expect(b.scoreDelta).toBe(5);
  });

  it("excludes industry/metric pairs missing from the latest run (no stale backfill)", () => {
    const report = buildMoversReport({
      latestRun,
      previousRun,
      responses: [
        // Airlines has data in BOTH runs
        response(1, 2, "positive_sentiment", [
          { brandId: 20, brandName: "X", score: 50 },
          { brandId: 21, brandName: "Y", score: 60 },
        ]),
        response(2, 2, "positive_sentiment", [
          { brandId: 20, brandName: "X", score: 65 },
          { brandId: 21, brandName: "Y", score: 55 },
        ]),
        // Banking only has data in the PREVIOUS run (partial latest run)
        response(1, 1, "positive_sentiment", [
          { brandId: 10, brandName: "A", score: 80 },
          { brandId: 11, brandName: "B", score: 70 },
        ]),
      ],
      industries,
      metrics,
    });
    expect(report.movers.every((m) => m.industryId === 2)).toBe(true);
    expect(report.movers.some((m) => m.industryId === 1)).toBe(false);
  });

  it("ignores responses from runs outside the anchored pair", () => {
    const report = buildMoversReport({
      latestRun,
      previousRun,
      responses: [
        response(99, 1, "positive_sentiment", [
          { brandId: 10, brandName: "A", score: 5 },
        ]),
        response(1, 1, "positive_sentiment", [
          { brandId: 10, brandName: "A", score: 80 },
        ]),
        response(2, 1, "positive_sentiment", [
          { brandId: 10, brandName: "A", score: 81 },
        ]),
      ],
      industries,
      metrics,
    });
    expect(report.movers).toHaveLength(1);
    expect(report.movers[0]!.scoreDelta).toBe(1);
  });
});
