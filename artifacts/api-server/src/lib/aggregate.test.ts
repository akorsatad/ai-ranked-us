import { describe, it, expect } from "vitest";
import { averageTrends } from "./aggregate";
import type { SurveyResponseRow, StoredBrandTrend } from "@workspace/db";

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
