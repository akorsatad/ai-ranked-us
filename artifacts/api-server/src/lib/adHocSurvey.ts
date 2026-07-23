import { eq } from "drizzle-orm";
import {
  db,
  enginesTable,
  adHocRequestsTable,
  type AdHocResults,
  type AdHocMetricResult,
  type AdHocRankingEntry,
} from "@workspace/db";
import { METRICS } from "./metrics";
import { callEngine } from "./engineClients";
import { logger } from "./logger";

interface TempBrand {
  id: number;
  name: string;
}

function makeTempBrands(brand: string, competitors: string[]): TempBrand[] {
  return [brand, ...competitors].map((name, idx) => ({ id: idx + 1, name }));
}

function buildAdHocPrompt(
  brands: TempBrand[],
  metricLabel: string,
  metricDescription: string,
  higherIsBetter: boolean,
  country: string,
): string {
  const names = brands.map((b) => b.name);
  const countryLabel = country === "US" ? "US" : country;
  const direction = higherIsBetter
    ? "higher score = better performance on this dimension"
    : "higher score = MORE of this (i.e. worse for the brand)";
  return [
    `You are being surveyed, as of today, about how ${countryLabel} consumers perceive brands.`,
    ``,
    `Dimension surveyed: ${metricLabel} — ${metricDescription}.`,
    ``,
    `Rank these ${names.length} brands on this dimension for ${countryLabel} consumers: ${names.join(", ")}.`,
    ``,
    `Scoring: integer 0-100, ${direction}. Rank 1 = highest score.`,
    ``,
    `Respond with STRICT JSON only, no markdown fences, exactly this shape:`,
    `{"rankings":[{"brand":"<name exactly as given>","rank":1,"score":87,"rationale":"<one short sentence>"}]}`,
  ].join("\n");
}

function parseJsonBlock(text: string): unknown {
  let cleaned = text.trim();
  const fenceMatch = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch?.[1]) cleaned = fenceMatch[1].trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start >= 0 && end > start) cleaned = cleaned.slice(start, end + 1);
  return JSON.parse(cleaned);
}

function normalizeName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function matchBrand(brands: TempBrand[], name: string): TempBrand | undefined {
  const target = normalizeName(name);
  return (
    brands.find((b) => normalizeName(b.name) === target) ??
    brands.find(
      (b) =>
        normalizeName(b.name).includes(target) ||
        target.includes(normalizeName(b.name)),
    )
  );
}

function averageMetrics(
  engineResults: { metrics: AdHocMetricResult[] }[],
): AdHocMetricResult[] {
  const metricMap = new Map<string, { scores: Map<string, number[]>; meta: AdHocMetricResult }>();

  for (const er of engineResults) {
    for (const metric of er.metrics) {
      if (!metricMap.has(metric.metricKey)) {
        metricMap.set(metric.metricKey, {
          scores: new Map(),
          meta: { ...metric, entries: [] },
        });
      }
      const slot = metricMap.get(metric.metricKey)!;
      for (const entry of metric.entries) {
        if (!slot.scores.has(entry.brandName)) {
          slot.scores.set(entry.brandName, []);
        }
        slot.scores.get(entry.brandName)!.push(entry.score);
      }
    }
  }

  const result: AdHocMetricResult[] = [];
  for (const [metricKey, slot] of metricMap) {
    const entries: AdHocRankingEntry[] = [];
    for (const [brandName, scores] of slot.scores) {
      const avg = scores.reduce((a, b) => a + b, 0) / scores.length;
      entries.push({ brandName, rank: 0, score: Math.round(avg), rationale: null });
    }
    entries.sort((a, b) => b.score - a.score);
    entries.forEach((e, i) => (e.rank = i + 1));
    result.push({ ...slot.meta, metricKey, entries });
  }
  return result;
}

export async function runAdHocSurvey(
  requestId: number,
  brand: string,
  competitors: string[],
  country: string,
): Promise<void> {
  const brands = makeTempBrands(brand, competitors);
  const engines = (await db.select().from(enginesTable)).filter((e) => e.enabled);

  if (engines.length === 0) {
    await db
      .update(adHocRequestsTable)
      .set({ status: "failed", error: "No AI engines are enabled", completedAt: new Date() })
      .where(eq(adHocRequestsTable.id, requestId));
    return;
  }

  await db
    .update(adHocRequestsTable)
    .set({ status: "running" })
    .where(eq(adHocRequestsTable.id, requestId));

  const engineResults: { engineKey: string; engineName: string; metrics: AdHocMetricResult[] }[] = [];

  for (const engine of engines) {
    const metrics: AdHocMetricResult[] = [];
    for (const metric of METRICS) {
      try {
        const prompt = buildAdHocPrompt(brands, metric.label, metric.description, metric.higherIsBetter, country);
        const raw = await callEngine(engine, prompt);
        const parsed = parseJsonBlock(raw) as {
          rankings?: { brand?: string; rank?: number; score?: number; rationale?: string }[];
        };
        if (!Array.isArray(parsed.rankings) || parsed.rankings.length === 0) continue;

        const entries: AdHocRankingEntry[] = [];
        for (const r of parsed.rankings) {
          if (!r.brand) continue;
          const matched = matchBrand(brands, r.brand);
          if (!matched) continue;
          entries.push({
            brandName: matched.name,
            rank: typeof r.rank === "number" ? r.rank : entries.length + 1,
            score: Math.max(0, Math.min(100, Number(r.score ?? 0))),
            rationale: r.rationale ? String(r.rationale).slice(0, 400) : null,
          });
        }
        if (entries.length > 0) {
          entries.sort((a, b) => a.rank - b.rank);
          metrics.push({
            metricKey: metric.key,
            metricLabel: metric.label,
            higherIsBetter: metric.higherIsBetter,
            entries,
          });
        }
      } catch (err) {
        logger.warn({ requestId, engine: engine.key, metric: metric.key, err }, "Ad-hoc query failed");
      }
    }
    if (metrics.length > 0) {
      engineResults.push({ engineKey: engine.key, engineName: engine.name, metrics });
    }
  }

  if (engineResults.length === 0) {
    await db
      .update(adHocRequestsTable)
      .set({ status: "failed", error: "All engine queries failed", completedAt: new Date() })
      .where(eq(adHocRequestsTable.id, requestId));
    return;
  }

  const results: AdHocResults = {
    byEngine: engineResults,
    averaged: averageMetrics(engineResults),
  };

  await db
    .update(adHocRequestsTable)
    .set({ status: "completed", results, completedAt: new Date() })
    .where(eq(adHocRequestsTable.id, requestId));

  logger.info({ requestId }, "Ad-hoc survey completed");
}

export async function suggestCompetitors(brand: string, country: string): Promise<string[]> {
  const engines = (await db.select().from(enginesTable)).filter((e) => e.enabled);
  if (engines.length === 0) throw new Error("No AI engines enabled");

  const engine = engines[0]!;
  const countryLabel = country === "US" ? "US" : country;
  const prompt = [
    `You are a market research analyst. For the brand "${brand}" in the ${countryLabel} market,`,
    `suggest 4 to 6 direct competitors that most ${countryLabel} consumers would recognize.`,
    `Return STRICT JSON only, no markdown fences:`,
    `{"competitors":["Brand A","Brand B","Brand C","Brand D"]}`,
  ].join("\n");

  const raw = await callEngine(engine, prompt);
  const parsed = parseJsonBlock(raw) as { competitors?: unknown[] };
  if (!Array.isArray(parsed.competitors)) throw new Error("Invalid competitor response");
  return parsed.competitors
    .filter((c) => typeof c === "string" && c.trim().length > 0)
    .map((c) => String(c).trim())
    .slice(0, 8);
}
