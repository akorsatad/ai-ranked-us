import { and, eq, inArray } from "drizzle-orm";
import {
  db,
  dailyMeasurementsTable,
  enginesTable,
  industriesTable,
  trendOutliersTable,
  appSettingsTable,
  type TrendOutlierRow,
} from "@workspace/db";
import { callEngine } from "./engineClients";
import { getMetric } from "./metrics";
import { logger } from "./logger";

export interface OutlierSettings {
  enabled: boolean;
  sigma: number; // threshold in standard deviations (default 3)
  minPoints: number; // minimum history before a series can flag (default 8)
  maxExplanationsPerRun: number; // cap engine explanation calls (default 20)
}

const DEFAULTS: OutlierSettings = {
  enabled: true,
  sigma: 3,
  minPoints: 8,
  maxExplanationsPerRun: 20,
};

const KEYS = {
  enabled: "outlier_enabled",
  sigma: "outlier_sigma",
  minPoints: "outlier_min_points",
  maxExpl: "outlier_max_explanations",
} as const;

export async function getOutlierSettings(): Promise<OutlierSettings> {
  const rows = await db
    .select()
    .from(appSettingsTable)
    .where(
      inArray(appSettingsTable.key, [
        KEYS.enabled,
        KEYS.sigma,
        KEYS.minPoints,
        KEYS.maxExpl,
      ]),
    );
  const map = new Map(rows.map((r) => [r.key, r.value]));
  const num = (k: string, d: number) => {
    const v = Number(map.get(k));
    return Number.isFinite(v) ? v : d;
  };
  return {
    enabled: map.has(KEYS.enabled)
      ? map.get(KEYS.enabled) === "true"
      : DEFAULTS.enabled,
    sigma: Math.max(0.5, num(KEYS.sigma, DEFAULTS.sigma)),
    minPoints: Math.max(3, Math.round(num(KEYS.minPoints, DEFAULTS.minPoints))),
    maxExplanationsPerRun: Math.max(
      0,
      Math.round(num(KEYS.maxExpl, DEFAULTS.maxExplanationsPerRun)),
    ),
  };
}

export async function setOutlierSettings(
  patch: Partial<OutlierSettings>,
): Promise<OutlierSettings> {
  const entries: [string, string][] = [];
  if (patch.enabled != null) entries.push([KEYS.enabled, String(patch.enabled)]);
  if (patch.sigma != null) entries.push([KEYS.sigma, String(patch.sigma)]);
  if (patch.minPoints != null)
    entries.push([KEYS.minPoints, String(patch.minPoints)]);
  if (patch.maxExplanationsPerRun != null)
    entries.push([KEYS.maxExpl, String(patch.maxExplanationsPerRun)]);
  for (const [key, value] of entries) {
    await db
      .insert(appSettingsTable)
      .values({ key, value })
      .onConflictDoUpdate({ target: appSettingsTable.key, set: { value } });
  }
  return getOutlierSettings();
}

/** population standard deviation */
function stddev(values: number[], mean: number): number {
  if (values.length === 0) return 0;
  const variance =
    values.reduce((a, v) => a + (v - mean) * (v - mean), 0) / values.length;
  return Math.sqrt(variance);
}

interface Candidate {
  engineId: number;
  industryId: number;
  brandId: number;
  brandName: string;
  metricKey: string;
  value: number;
  mean: number;
  stddev: number;
  sigma: number; // signed
  direction: "up" | "down";
  sampleSize: number;
  measuredAt: Date;
}

/**
 * Scan every per-(engine, industry, metric, brand) measured-score series and
 * flag the latest point when it lies beyond ±Nσ of the rest of the series.
 * New outliers are stored; each (up to the cap) is explained by its own engine
 * at that engine's highest model. Returns the outliers created.
 */
export async function detectOutliers(
  runId?: number,
): Promise<TrendOutlierRow[]> {
  const settings = await getOutlierSettings();
  if (!settings.enabled) return [];

  const rows = await db.select().from(dailyMeasurementsTable);
  // Group into series keyed by engine|industry|metric|brand.
  const series = new Map<
    string,
    { key: Omit<Candidate, "value" | "mean" | "stddev" | "sigma" | "direction" | "sampleSize">[]; points: { score: number; at: Date }[] }
  >();
  const meta = new Map<
    string,
    { engineId: number; industryId: number; brandId: number; brandName: string; metricKey: string }
  >();
  for (const r of rows) {
    const k = `${r.engineId}|${r.industryId}|${r.metricKey}|${r.brandId}`;
    let s = series.get(k);
    if (!s) {
      s = { key: [], points: [] };
      series.set(k, s);
      meta.set(k, {
        engineId: r.engineId,
        industryId: r.industryId,
        brandId: r.brandId,
        brandName: r.brandName,
        metricKey: r.metricKey,
      });
    }
    s.points.push({ score: r.scoreX10 / 10, at: r.measuredAt });
  }

  const candidates: Candidate[] = [];
  for (const [k, s] of series) {
    if (s.points.length < settings.minPoints) continue;
    s.points.sort((a, b) => a.at.getTime() - b.at.getTime());
    const latest = s.points[s.points.length - 1]!;
    const history = s.points.slice(0, -1).map((p) => p.score);
    const mean = history.reduce((a, v) => a + v, 0) / history.length;
    const sd = stddev(history, mean);
    if (sd <= 0) continue; // flat history — no meaningful outlier
    const sigma = (latest.score - mean) / sd;
    if (Math.abs(sigma) < settings.sigma) continue;
    const m = meta.get(k)!;
    candidates.push({
      ...m,
      value: Math.round(latest.score * 10) / 10,
      mean: Math.round(mean * 100) / 100,
      stddev: Math.round(sd * 100) / 100,
      sigma: Math.round(sigma * 100) / 100,
      direction: sigma >= 0 ? "up" : "down",
      sampleSize: history.length,
      measuredAt: latest.at,
    });
  }

  if (candidates.length === 0) return [];

  // Insert, skipping points already flagged (unique index handles the race).
  const engines = await db.select().from(enginesTable);
  const engineById = new Map(engines.map((e) => [e.id, e]));
  const industries = await db.select().from(industriesTable);
  const industryById = new Map(industries.map((i) => [i.id, i]));

  const created: TrendOutlierRow[] = [];
  let explanations = 0;
  // Explain the most extreme first.
  candidates.sort((a, b) => Math.abs(b.sigma) - Math.abs(a.sigma));
  for (const c of candidates) {
    const [row] = await db
      .insert(trendOutliersTable)
      .values({
        engineId: c.engineId,
        industryId: c.industryId,
        brandId: c.brandId,
        brandName: c.brandName,
        metricKey: c.metricKey,
        value: c.value,
        mean: c.mean,
        stddev: c.stddev,
        sigma: c.sigma,
        direction: c.direction,
        sampleSize: c.sampleSize,
        measuredAt: c.measuredAt,
        runId: runId ?? null,
      })
      .onConflictDoNothing()
      .returning();
    if (!row) continue; // already flagged previously
    created.push(row);

    // Ask the owning engine (at its highest model) to explain the shift.
    if (explanations < settings.maxExplanationsPerRun) {
      const engine = engineById.get(c.engineId);
      if (engine) {
        explanations++;
        try {
          const model = engine.explainerModel?.trim() || engine.model;
          const metric = getMetric(c.metricKey);
          const explanation = await explainOutlier(engine, model, c, {
            industryName: industryById.get(c.industryId)?.name ?? "its industry",
            metricLabel: metric?.label ?? c.metricKey,
          });
          const [updated] = await db
            .update(trendOutliersTable)
            .set({ explanation, explanationModel: model })
            .where(eq(trendOutliersTable.id, row.id))
            .returning();
          if (updated) created[created.length - 1] = updated;
        } catch (err) {
          logger.warn(
            { err, outlierId: row.id, engine: engine.key },
            "Outlier explanation call failed",
          );
        }
      }
    }
  }
  logger.info(
    { created: created.length, explained: explanations },
    "Outlier detection complete",
  );
  return created;
}

async function explainOutlier(
  engine: { id: number; provider: string; model: string; name: string; key: string; vendor: string; enabled: boolean; explainerModel: string | null },
  model: string,
  c: Candidate,
  ctx: { industryName: string; metricLabel: string },
): Promise<string> {
  const dir = c.direction === "up" ? "risen" : "dropped";
  const prompt = [
    `You previously scored the brand "${c.brandName}" on the "${ctx.metricLabel}" dimension among ${ctx.industryName} brands (US consumers).`,
    `Your latest score is ${c.value}. Across its recent history it averaged ${c.mean} (standard deviation ${c.stddev}), so today's value is ${Math.abs(c.sigma)} standard deviations ${c.direction === "up" ? "above" : "below"} the norm — a statistical outlier: the score has sharply ${dir}.`,
    ``,
    `Explain what SPECIFIC, concrete developments support this shift: recent news, product launches, controversies, earnings, campaigns, leadership changes, market events, or shifts in consumer perception. Cite concrete specifics, not generic statements. If you are not confident, state the most likely concrete drivers and note the uncertainty.`,
    `Answer in 120-200 words of plain prose.`,
  ].join("\n");
  const result = await callEngine(engine as never, model, prompt);
  return (result.text ?? "").trim();
}
