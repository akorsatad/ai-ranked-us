import { describe, it, expect } from "vitest";
import { computeAlertsForPair, type AlertSettings } from "./alerts";
import { averageEntries } from "./aggregate";
import type { StoredRankingEntry, SurveyResponseRow } from "@workspace/db";

const settings: AlertSettings = {
  scoreDropThreshold: 10,
  rankDropThreshold: 2,
  emailEnabled: false,
  emailRecipient: "",
};

const higherMetric = {
  key: "positive_sentiment",
  label: "Positive Sentiment",
  higherIsBetter: true,
};

const lowerMetric = {
  key: "negative_sentiment",
  label: "Negative Sentiment",
  higherIsBetter: false,
};

function entry(
  brandId: number,
  score: number,
  rank: number,
): StoredRankingEntry {
  return { brandId, brandName: `Brand ${brandId}`, score, rank, rationale: null };
}

describe("computeAlertsForPair — score deltas on higherIsBetter metrics", () => {
  it("alerts when a score DROPS by at least the threshold", () => {
    const alerts = computeAlertsForPair(
      [entry(1, 60, 1)],
      [entry(1, 75, 1)],
      higherMetric,
      settings,
    );
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatchObject({
      kind: "score_drop",
      brandId: 1,
      previousValue: 750,
      currentValue: 600,
      delta: 150,
      threshold: 100,
    });
  });

  it("does NOT alert when the score rises", () => {
    const alerts = computeAlertsForPair(
      [entry(1, 90, 1)],
      [entry(1, 70, 1)],
      higherMetric,
      settings,
    );
    expect(alerts).toHaveLength(0);
  });

  it("does NOT alert when the drop is below the threshold", () => {
    const alerts = computeAlertsForPair(
      [entry(1, 70.1, 1)],
      [entry(1, 80, 1)],
      higherMetric,
      settings,
    );
    expect(alerts).toHaveLength(0);
  });

  it("alerts exactly at the threshold boundary (>=)", () => {
    const alerts = computeAlertsForPair(
      [entry(1, 70, 1)],
      [entry(1, 80, 1)],
      higherMetric,
      settings,
    );
    expect(alerts).toHaveLength(1);
    expect(alerts[0]!.kind).toBe("score_drop");
  });
});

describe("computeAlertsForPair — inverted metrics (negative sentiment)", () => {
  it("alerts when the score RISES (more negative sentiment is bad)", () => {
    const alerts = computeAlertsForPair(
      [entry(1, 45, 1)],
      [entry(1, 30, 1)],
      lowerMetric,
      settings,
    );
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatchObject({
      kind: "score_drop",
      previousValue: 300,
      currentValue: 450,
      delta: 150,
    });
  });

  it("does NOT alert when the score drops (improvement)", () => {
    const alerts = computeAlertsForPair(
      [entry(1, 20, 1)],
      [entry(1, 40, 1)],
      lowerMetric,
      settings,
    );
    expect(alerts).toHaveLength(0);
  });

  it("alerts exactly at the threshold boundary for a rise", () => {
    const alerts = computeAlertsForPair(
      [entry(1, 40, 1)],
      [entry(1, 30, 1)],
      lowerMetric,
      settings,
    );
    expect(alerts).toHaveLength(1);
  });
});

describe("computeAlertsForPair — rank deltas", () => {
  it("alerts when the brand FALLS by at least the rank threshold", () => {
    const alerts = computeAlertsForPair(
      [entry(1, 80, 4)],
      [entry(1, 80, 1)],
      higherMetric,
      settings,
    );
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatchObject({
      kind: "rank_drop",
      previousValue: 1,
      currentValue: 4,
      delta: 3,
      threshold: 2,
    });
  });

  it("alerts exactly at the rank threshold boundary (>=)", () => {
    const alerts = computeAlertsForPair(
      [entry(1, 80, 3)],
      [entry(1, 80, 1)],
      higherMetric,
      settings,
    );
    expect(alerts).toHaveLength(1);
    expect(alerts[0]!.kind).toBe("rank_drop");
  });

  it("does NOT alert on a 1-position fall below the threshold", () => {
    const alerts = computeAlertsForPair(
      [entry(1, 80, 2)],
      [entry(1, 80, 1)],
      higherMetric,
      settings,
    );
    expect(alerts).toHaveLength(0);
  });

  it("does NOT alert when the brand rises in rank", () => {
    const alerts = computeAlertsForPair(
      [entry(1, 80, 1)],
      [entry(1, 80, 5)],
      higherMetric,
      settings,
    );
    expect(alerts).toHaveLength(0);
  });
});

describe("computeAlertsForPair — missing previous data", () => {
  it("skips brands with no previous entry", () => {
    const alerts = computeAlertsForPair(
      [entry(1, 10, 5), entry(2, 50, 1)],
      [entry(2, 55, 1)],
      higherMetric,
      settings,
    );
    expect(alerts).toHaveLength(0);
  });

  it("returns nothing when previous run is empty", () => {
    const alerts = computeAlertsForPair(
      [entry(1, 10, 5)],
      [],
      higherMetric,
      settings,
    );
    expect(alerts).toHaveLength(0);
  });

  it("can emit both score_drop and rank_drop for the same brand", () => {
    const alerts = computeAlertsForPair(
      [entry(1, 50, 4)],
      [entry(1, 80, 1)],
      higherMetric,
      settings,
    );
    expect(alerts.map((a) => a.kind).sort()).toEqual([
      "rank_drop",
      "score_drop",
    ]);
  });
});

describe("averageEntries — averaging and ranking used for comparison", () => {
  function response(
    entries: { brandId: number; score: number }[],
  ): SurveyResponseRow {
    return {
      entries: entries.map((e) => ({
        brandId: e.brandId,
        brandName: `Brand ${e.brandId}`,
        score: e.score,
        rank: 0,
        rationale: null,
      })),
    } as unknown as SurveyResponseRow;
  }

  it("averages scores across engines and rounds to one decimal", () => {
    const avg = averageEntries(
      [response([{ brandId: 1, score: 70 }]), response([{ brandId: 1, score: 75.11 }])],
      true,
    );
    expect(avg).toHaveLength(1);
    expect(avg[0]!.score).toBeCloseTo(72.6, 5);
  });

  it("ranks highest score first for higherIsBetter metrics", () => {
    const avg = averageEntries(
      [response([{ brandId: 1, score: 50 }, { brandId: 2, score: 90 }])],
      true,
    );
    expect(avg.find((e) => e.brandId === 2)!.rank).toBe(1);
    expect(avg.find((e) => e.brandId === 1)!.rank).toBe(2);
  });

  it("ranks LOWEST score first for inverted metrics (negative sentiment)", () => {
    const avg = averageEntries(
      [response([{ brandId: 1, score: 50 }, { brandId: 2, score: 90 }])],
      false,
    );
    expect(avg.find((e) => e.brandId === 1)!.rank).toBe(1);
    expect(avg.find((e) => e.brandId === 2)!.rank).toBe(2);
  });
});
