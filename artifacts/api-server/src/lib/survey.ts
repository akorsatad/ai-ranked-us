import { eq } from "drizzle-orm";
import {
  db,
  industriesTable,
  brandsTable,
  enginesTable,
  surveyRunsTable,
  surveyResponsesTable,
  type BrandRow,
  type EngineRow,
  type IndustryRow,
  type SurveyRunRow,
  type StoredRankingEntry,
  type StoredBrandTrend,
  type StoredTrendPoint,
} from "@workspace/db";
import { batchProcess } from "@workspace/integrations-openai-ai-server/batch";
import { METRICS, type MetricDef } from "./metrics";
import { callEngine } from "./engineClients";
import { logger } from "./logger";

let runInProgress = false;

export function isRunInProgress(): boolean {
  return runInProgress;
}

interface SurveyQuery {
  engine: EngineRow;
  industry: IndustryRow;
  brands: BrandRow[];
  metric: MetricDef;
}

function weekLabels(): string[] {
  const labels: string[] = [];
  const now = new Date();
  for (let i = 12; i >= 0; i--) {
    const d = new Date(now.getTime() - i * 7 * 24 * 60 * 60 * 1000);
    labels.push(
      `${d.toLocaleString("en-US", { month: "short" })} ${d.getDate()}`,
    );
  }
  return labels;
}

function buildPrompt(query: SurveyQuery): string {
  const names = query.brands.map((b) => b.name);
  const direction = query.metric.higherIsBetter
    ? "higher score = better performance on this dimension"
    : "higher score = MORE of this (i.e. worse for the brand)";
  return [
    `You are being surveyed, as of today, about how US consumers perceive major brands.`,
    ``,
    `Dimension surveyed: ${query.metric.label} — ${query.metric.description}.`,
    ``,
    `Rank these ${names.length} brands on this dimension for US consumers: ${names.join(", ")}.`,
    ``,
    `Also estimate a weekly trend line of each brand's score over the last 13 weeks (13 values, oldest week first, most recent week last), based on your available knowledge of how perception has been moving.`,
    ``,
    `Scoring: integer 0-100, ${direction}. Rank 1 = highest score.`,
    ``,
    `Respond with STRICT JSON only, no markdown fences, exactly this shape:`,
    `{"rankings":[{"brand":"<name exactly as given>","rank":1,"score":87,"rationale":"<one short sentence>"}],"trend":[{"brand":"<name exactly as given>","weekly_scores":[13 integers oldest first]}]}`,
  ].join("\n");
}

function parseJsonBlock(text: string): unknown {
  let cleaned = text.trim();
  const fenceMatch = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch && fenceMatch[1]) cleaned = fenceMatch[1].trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start >= 0 && end > start) cleaned = cleaned.slice(start, end + 1);
  return JSON.parse(cleaned);
}

function normalizeName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function matchBrand(brands: BrandRow[], name: string): BrandRow | undefined {
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

function parseResponse(
  query: SurveyQuery,
  raw: string,
): { entries: StoredRankingEntry[]; trend: StoredBrandTrend[] } {
  const parsed = parseJsonBlock(raw) as {
    rankings?: {
      brand?: string;
      rank?: number;
      score?: number;
      rationale?: string;
    }[];
    trend?: { brand?: string; weekly_scores?: number[] }[];
  };
  if (!Array.isArray(parsed.rankings) || parsed.rankings.length === 0) {
    throw new Error("Engine response missing rankings array");
  }

  const entries: StoredRankingEntry[] = [];
  for (const r of parsed.rankings) {
    if (!r.brand) continue;
    const brand = matchBrand(query.brands, r.brand);
    if (!brand) continue;
    entries.push({
      brandId: brand.id,
      brandName: brand.name,
      rank: typeof r.rank === "number" ? r.rank : entries.length + 1,
      score: Math.max(0, Math.min(100, Number(r.score ?? 0))),
      rationale: r.rationale ? String(r.rationale).slice(0, 500) : null,
    });
  }
  if (entries.length === 0) {
    throw new Error("No ranking entries matched known brands");
  }
  entries.sort((a, b) => a.rank - b.rank);

  const labels = weekLabels();
  const trend: StoredBrandTrend[] = [];
  for (const t of parsed.trend ?? []) {
    if (!t.brand || !Array.isArray(t.weekly_scores)) continue;
    const brand = matchBrand(query.brands, t.brand);
    if (!brand) continue;
    const scores = t.weekly_scores.slice(0, 13);
    const points: StoredTrendPoint[] = scores.map((s, i) => ({
      weekIndex: i,
      weekLabel: labels[i] ?? `W${i}`,
      score: Math.max(0, Math.min(100, Number(s))),
    }));
    trend.push({ brandId: brand.id, brandName: brand.name, points });
  }

  return { entries, trend };
}

export async function startSurveyRun(
  trigger: "scheduled" | "manual",
): Promise<SurveyRunRow | null> {
  if (runInProgress) return null;
  runInProgress = true;

  const engines = (await db.select().from(enginesTable)).filter(
    (e) => e.enabled,
  );
  const industries = (await db.select().from(industriesTable)).filter(
    (i) => i.enabled,
  );
  const brands = (await db.select().from(brandsTable)).filter(
    (b) => b.enabled,
  );

  const queries: SurveyQuery[] = [];
  for (const engine of engines) {
    for (const industry of industries) {
      const industryBrands = brands.filter(
        (b) => b.industryId === industry.id,
      );
      if (industryBrands.length === 0) continue;
      for (const metric of METRICS) {
        queries.push({ engine, industry, brands: industryBrands, metric });
      }
    }
  }

  const [run] = await db
    .insert(surveyRunsTable)
    .values({
      status: "running",
      trigger,
      totalQueries: queries.length,
    })
    .returning();

  if (!run) {
    runInProgress = false;
    throw new Error("Failed to create survey run");
  }

  // Fire and forget — run continues in the background.
  void executeRun(run, queries)
    .catch((err) => {
      logger.error({ err, runId: run.id }, "Survey run crashed");
    })
    .finally(() => {
      runInProgress = false;
    });

  return run;
}

async function executeRun(
  run: SurveyRunRow,
  queries: SurveyQuery[],
): Promise<void> {
  logger.info(
    { runId: run.id, totalQueries: queries.length },
    "Survey run started",
  );
  let succeeded = 0;
  let failed = 0;

  await batchProcess(
    queries,
    async (query) => {
      // Every query is an entirely new, isolated request to the engine.
      try {
        const raw = await callEngine(query.engine, buildPrompt(query));
        const { entries, trend } = parseResponse(query, raw);
        await db.insert(surveyResponsesTable).values({
          runId: run.id,
          engineId: query.engine.id,
          industryId: query.industry.id,
          metricKey: query.metric.key,
          status: "ok",
          entries,
          trend,
        });
        succeeded++;
      } catch (err) {
        failed++;
        const message = err instanceof Error ? err.message : String(err);
        logger.warn(
          {
            runId: run.id,
            engine: query.engine.key,
            industry: query.industry.slug,
            metric: query.metric.key,
            error: message,
          },
          "Survey query failed",
        );
        await db.insert(surveyResponsesTable).values({
          runId: run.id,
          engineId: query.engine.id,
          industryId: query.industry.id,
          metricKey: query.metric.key,
          status: "failed",
          error: message.slice(0, 1000),
        });
      }
      return null;
    },
    { concurrency: 4, retries: 2 },
  );

  const status =
    failed === 0 ? "completed" : succeeded === 0 ? "failed" : "partial";
  await db
    .update(surveyRunsTable)
    .set({
      status,
      completedAt: new Date(),
      succeededQueries: succeeded,
      failedQueries: failed,
      error:
        succeeded === 0 && failed > 0
          ? "All engine queries failed. Check that AI integrations are provisioned."
          : null,
    })
    .where(eq(surveyRunsTable.id, run.id));
  logger.info({ runId: run.id, status, succeeded, failed }, "Survey run done");
}
