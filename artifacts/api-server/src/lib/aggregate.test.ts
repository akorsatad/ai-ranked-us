import { describe, it, expect } from "vitest";
import { averageTrends, computeMovers, type RunSnapshot } from "./aggregate";
import type {
  SurveyResponseRow,
  StoredBrandTrend,
  StoredRankingEntry,
} from "@workspace/db";

function rankingEntry(
  brandId: number,
  rank: number,
  score: number,
): StoredRankingEntry {
  return {
    brandId,
    brandName: `Brand ${brandId}`,
    rank,
    score,
    rationale: null,
  };
}

function snapshot(runId: number, entries: StoredRankingEntry[]): RunSnapshot {
  return { runId, date: `2026-07-0${runId}T00:00:00.000Z`, entries };
}

function trendResponse(trend: StoredBrandTrend[]): SurveyResponseRow {
  return { trend } as unknown as SurveyResponseRow;
}

function brandTrend(
  brandId: number,
  points: { weekIndex: number; score: number; weekLabel?: string }[],
): StoredBrandTrend {
  return {
    brandId,
    brandName: `Brand ${brandId}`,
    points: points.map((p) => ({
      weekIndex: p.weekIndex,
      weekLabel: p.weekLabel ?? `Week ${p.weekIndex}`,
      score: p.score,
    })),
  };
}

describe("computeMovers — rank delta sign convention", () => {
  it("positive rankDelta when a brand improves (moves toward rank 1)", () => {
    const previous = snapshot(1, [
      rankingEntry(1, 1, 90),
      rankingEntry(2, 2, 80),
    ]);
    const current = snapshot(2, [
      rankingEntry(2, 1, 95),
      rankingEntry(1, 2, 85),
    ]);
    const movers = computeMovers(previous, current);
    const b2 = movers.find((m) => m.brandId === 2)!;
    expect(b2.previousRank).toBe(2);
    expect(b2.currentRank).toBe(1);
    expect(b2.rankDelta).toBe(1); // moved UP
  });

  it("negative rankDelta when a brand drops in rank", () => {
    const previous = snapshot(1, [
      rankingEntry(1, 1, 90),
      rankingEntry(2, 2, 80),
      rankingEntry(3, 3, 70),
    ]);
    const current = snapshot(2, [
      rankingEntry(2, 1, 95),
      rankingEntry(3, 2, 85),
      rankingEntry(1, 3, 60),
    ]);
    const movers = computeMovers(previous, current);
    const b1 = movers.find((m) => m.brandId === 1)!;
    expect(b1.rankDelta).toBe(-2); // dropped from 1 to 3
  });

  it("zero rankDelta when rank is unchanged", () => {
    const previous = snapshot(1, [rankingEntry(1, 1, 90)]);
    const current = snapshot(2, [rankingEntry(1, 1, 91)]);
    const movers = computeMovers(previous, current);
    expect(movers[0]!.rankDelta).toBe(0);
  });
});

describe("computeMovers — score delta rounding", () => {
  it("rounds scoreDelta to one decimal place", () => {
    const previous = snapshot(1, [rankingEntry(1, 1, 80.15)]);
    const current = snapshot(2, [rankingEntry(1, 1, 80.4)]);
    const movers = computeMovers(previous, current);
    expect(movers[0]!.scoreDelta).toBe(0.3);
  });

  it("rounds negative deltas correctly and avoids float noise", () => {
    const previous = snapshot(1, [rankingEntry(1, 1, 0.3)]);
    const current = snapshot(2, [rankingEntry(1, 1, 0.1)]);
    const movers = computeMovers(previous, current);
    expect(movers[0]!.scoreDelta).toBe(-0.2);
  });

  it("preserves previous and current scores unrounded", () => {
    const previous = snapshot(1, [rankingEntry(1, 1, 80.15)]);
    const current = snapshot(2, [rankingEntry(1, 1, 82.35)]);
    const movers = computeMovers(previous, current);
    expect(movers[0]!.previousScore).toBe(80.15);
    expect(movers[0]!.currentScore).toBe(82.35);
  });
});

describe("computeMovers — brands missing from previous snapshot", () => {
  it("skips brands not present in the previous snapshot", () => {
    const previous = snapshot(1, [rankingEntry(1, 1, 90)]);
    const current = snapshot(2, [
      rankingEntry(1, 1, 92),
      rankingEntry(99, 2, 50), // new brand
    ]);
    const movers = computeMovers(previous, current);
    expect(movers).toHaveLength(1);
    expect(movers[0]!.brandId).toBe(1);
  });

  it("ignores brands that disappeared from the current snapshot", () => {
    const previous = snapshot(1, [
      rankingEntry(1, 1, 90),
      rankingEntry(2, 2, 80),
    ]);
    const current = snapshot(2, [rankingEntry(1, 1, 91)]);
    const movers = computeMovers(previous, current);
    expect(movers.map((m) => m.brandId)).toEqual([1]);
  });

  it("returns empty when snapshots share no brands", () => {
    const previous = snapshot(1, [rankingEntry(1, 1, 90)]);
    const current = snapshot(2, [rankingEntry(2, 1, 80)]);
    expect(computeMovers(previous, current)).toEqual([]);
  });

  it("returns empty for empty snapshots", () => {
    expect(computeMovers(snapshot(1, []), snapshot(2, []))).toEqual([]);
  });
});

describe("averageTrends — multi-engine averaging", () => {
  it("averages the same week across engines and rounds to one decimal", () => {
    const result = averageTrends([
      trendResponse([brandTrend(1, [{ weekIndex: 0, score: 70 }])]),
      trendResponse([brandTrend(1, [{ weekIndex: 0, score: 75.11 }])]),
    ]);
    expect(result).toHaveLength(1);
    expect(result[0]!.brandId).toBe(1);
    expect(result[0]!.points).toHaveLength(1);
    expect(result[0]!.points[0]).toMatchObject({
      weekIndex: 0,
      score: 72.6,
    });
  });

  it("keeps brands separate and averages each independently", () => {
    const result = averageTrends([
      trendResponse([
        brandTrend(1, [{ weekIndex: 2, score: 40 }]),
        brandTrend(2, [{ weekIndex: 2, score: 80 }]),
      ]),
      trendResponse([
        brandTrend(1, [{ weekIndex: 2, score: 60 }]),
        brandTrend(2, [{ weekIndex: 2, score: 90 }]),
      ]),
    ]);
    const b1 = result.find((t) => t.brandId === 1)!;
    const b2 = result.find((t) => t.brandId === 2)!;
    expect(b1.points[0]!.score).toBe(50);
    expect(b2.points[0]!.score).toBe(85);
    expect(b1.brandName).toBe("Brand 1");
  });

  it("averages only engines that reported a given week", () => {
    const result = averageTrends([
      trendResponse([
        brandTrend(1, [
          { weekIndex: 0, score: 10 },
          { weekIndex: 1, score: 20 },
        ]),
      ]),
      trendResponse([brandTrend(1, [{ weekIndex: 0, score: 30 }])]),
    ]);
    const points = result[0]!.points;
    expect(points).toHaveLength(2);
    expect(points.find((p) => p.weekIndex === 0)!.score).toBe(20); // (10+30)/2
    expect(points.find((p) => p.weekIndex === 1)!.score).toBe(20); // single engine
  });

  it("handles responses with null/missing trend arrays", () => {
    const result = averageTrends([
      trendResponse([brandTrend(1, [{ weekIndex: 5, score: 42 }])]),
      { trend: null } as unknown as SurveyResponseRow,
    ]);
    expect(result).toHaveLength(1);
    expect(result[0]!.points[0]!.score).toBe(42);
  });

  it("returns an empty array for no responses", () => {
    expect(averageTrends([])).toEqual([]);
  });
});

describe("averageTrends — out-of-range weekIndex", () => {
  it("skips negative weekIndex points", () => {
    const result = averageTrends([
      trendResponse([
        brandTrend(1, [
          { weekIndex: -1, score: 999 },
          { weekIndex: 0, score: 50 },
        ]),
      ]),
    ]);
    expect(result[0]!.points).toHaveLength(1);
    expect(result[0]!.points[0]).toMatchObject({ weekIndex: 0, score: 50 });
  });

  it("skips weekIndex above 12", () => {
    const result = averageTrends([
      trendResponse([
        brandTrend(1, [
          { weekIndex: 13, score: 999 },
          { weekIndex: 12, score: 60 },
        ]),
      ]),
    ]);
    expect(result[0]!.points).toHaveLength(1);
    expect(result[0]!.points[0]).toMatchObject({ weekIndex: 12, score: 60 });
  });

  it("returns a brand with zero points if all its points are out of range", () => {
    const result = averageTrends([
      trendResponse([
        brandTrend(1, [
          { weekIndex: -3, score: 10 },
          { weekIndex: 20, score: 10 },
        ]),
      ]),
    ]);
    expect(result).toHaveLength(1);
    expect(result[0]!.points).toEqual([]);
  });
});

describe("averageTrends — missing weeks filtered out", () => {
  it("omits weeks no engine reported instead of emitting zero scores", () => {
    const result = averageTrends([
      trendResponse([
        brandTrend(1, [
          { weekIndex: 0, score: 10 },
          { weekIndex: 12, score: 30 },
        ]),
      ]),
    ]);
    const points = result[0]!.points;
    expect(points.map((p) => p.weekIndex)).toEqual([0, 12]);
    expect(points.every((p) => p.score !== 0)).toBe(true);
  });

  it("filters out a zero-count week even between reported weeks", () => {
    const result = averageTrends([
      trendResponse([
        brandTrend(1, [
          { weekIndex: 3, score: 10 },
          { weekIndex: 5, score: 20 },
        ]),
      ]),
    ]);
    expect(result[0]!.points.map((p) => p.weekIndex)).toEqual([3, 5]);
  });
});

describe("averageTrends — label fallback", () => {
  it("uses the first non-empty label seen for a week", () => {
    const result = averageTrends([
      trendResponse([
        brandTrend(1, [{ weekIndex: 4, score: 10, weekLabel: "Jun 1" }]),
      ]),
      trendResponse([
        brandTrend(1, [{ weekIndex: 4, score: 20, weekLabel: "June 1st" }]),
      ]),
    ]);
    expect(result[0]!.points[0]!.weekLabel).toBe("Jun 1");
  });

  it("falls back to W<index> when all labels are empty", () => {
    const result = averageTrends([
      trendResponse([
        brandTrend(1, [{ weekIndex: 7, score: 10, weekLabel: "" }]),
      ]),
    ]);
    expect(result[0]!.points[0]!.weekLabel).toBe("W7");
  });

  it("adopts a later engine's label when the first engine's label is empty", () => {
    const result = averageTrends([
      trendResponse([
        brandTrend(1, [{ weekIndex: 2, score: 10, weekLabel: "" }]),
      ]),
      trendResponse([
        brandTrend(1, [{ weekIndex: 2, score: 20, weekLabel: "May 10" }]),
      ]),
    ]);
    expect(result[0]!.points[0]!.weekLabel).toBe("May 10");
  });
});
