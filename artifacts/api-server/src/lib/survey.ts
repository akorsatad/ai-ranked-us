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
  type StoredKeyWarning,
} from "@workspace/db";
import {
  preflightProviderKeys,
  getKeyPreflightMode,
  isProvider,
} from "./apiKeys";
import { batchProcess } from "@workspace/integrations-openai-ai-server/batch";
import { METRICS, type MetricDef } from "./metrics";
import { callEngine } from "./engineClients";
import { detectAlertsForRun } from "./alerts";
import { logger } from "./logger";

let runInProgress = false;

/**
 * Mark any survey runs left in status "running" (e.g. after a server
 * restart interrupted them) as failed, so they don't show as in-progress
 * forever. Call once on server startup, before any new run can begin.
 */
export async function failInterruptedRuns(): Promise<void> {
  const interrupted = await db
    .update(surveyRunsTable)
    .set({
      status: "failed",
      completedAt: new Date(),
      error: "Interrupted by server restart",
    })
    .where(eq(surveyRunsTable.status, "running"))
    .returning({ id: surveyRunsTable.id });
  if (interrupted.length > 0) {
    logger.warn(
      { runIds: interrupted.map((r) => r.id) },
      "Marked interrupted survey runs as failed after restart",
    );
  }
}

export function isRunInProgress(): boolean {
  return runInProgress;
}

/**
 * Industries waiting for an automatic scoped survey run. Populated when an
 * auto run is requested while another run is already in progress; drained
 * as soon as the current run finishes.
 */
const pendingAutoRunIndustryIds: number[] = [];

/**
 * Request an automatic survey run scoped to one industry (e.g. right after
 * the industry gets its first brand). If a run is already in progress the
 * request is queued and started once the current run finishes, instead of
 * being dropped. Industries with no enabled brands are skipped at start
 * time (they would produce zero queries).
 */
export function requestAutoScopedRun(industryId: number): void {
  if (runInProgress) {
    if (!pendingAutoRunIndustryIds.includes(industryId)) {
      pendingAutoRunIndustryIds.push(industryId);
      logger.info(
        { industryId },
        "Run in progress — queued automatic scoped survey run",
      );
    }
    return;
  }
  void startSurveyRun("auto", industryId)
    .then((result) => {
      switch (result.kind) {
        case "started":
          logger.info(
            { runId: result.run.id, industryId },
            "Automatic scoped survey run started",
          );
          break;
        case "in_progress":
          // Lost the race to another run; re-queue instead of dropping.
          requestAutoScopedRun(industryId);
          break;
        case "blocked":
          logger.error(
            { runId: result.run.id, industryId, failures: result.failures },
            "Automatic scoped survey run blocked by provider key pre-flight check",
          );
          break;
        case "skipped":
          // No surveyable queries — nothing to do.
          break;
      }
    })
    .catch((err) => {
      logger.error(
        { err, industryId },
        "Failed to start automatic scoped survey run",
      );
    });
}

function drainPendingAutoRuns(): void {
  const industryId = pendingAutoRunIndustryIds.shift();
  if (industryId === undefined) return;
  requestAutoScopedRun(industryId);
}

interface SurveyQuery {
  engine: EngineRow;
  industry: IndustryRow;
  brands: BrandRow[];
  metric: MetricDef;
}

import {
  getActivePromptTemplate,
  renderPromptTemplate,
  placeholderValuesFor,
} from "./promptTemplate";

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

function buildPrompt(query: SurveyQuery, template: string): string {
  return renderPromptTemplate(
    template,
    placeholderValuesFor(query.metric, query.brands),
  );
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

export type StartRunResult =
  | { kind: "started"; run: SurveyRunRow }
  | { kind: "in_progress" }
  | { kind: "skipped" }
  | { kind: "blocked"; run: SurveyRunRow; failures: StoredKeyWarning[] };

export function describeKeyFailures(failures: StoredKeyWarning[]): string {
  return failures
    .map((f) =>
      f.source === "none"
        ? `${f.provider}: no API key configured`
        : `${f.provider}: ${f.error}`,
    )
    .join("; ");
}

export async function startSurveyRun(
  trigger: "scheduled" | "manual" | "auto",
  industryId?: number,
): Promise<StartRunResult> {
  if (runInProgress) return { kind: "in_progress" };
  runInProgress = true;
  try {
    const result = await beginSurveyRun(trigger, industryId);
    if (result.kind !== "started") {
      // Nothing was started (skipped or blocked) — release the lock.
      runInProgress = false;
      drainPendingAutoRuns();
    }
    return result;
  } catch (err) {
    // Release the lock if setup fails before the background run takes over,
    // then let queued auto runs proceed.
    runInProgress = false;
    drainPendingAutoRuns();
    throw err;
  }
}

async function beginSurveyRun(
  trigger: "scheduled" | "manual" | "auto",
  industryId?: number,
): Promise<StartRunResult> {
  const engines = (await db.select().from(enginesTable)).filter(
    (e) => e.enabled,
  );

  // Pre-flight: verify the key for every provider used by an enabled engine.
  let keyWarnings: StoredKeyWarning[] = [];
  try {
    keyWarnings = await preflightProviderKeys(
      engines.map((e) => e.provider).filter(isProvider),
    );
  } catch (err) {
    // A crashed check must not prevent surveys from running.
    logger.error({ err }, "Provider key pre-flight check crashed");
  }

  if (keyWarnings.length > 0) {
    const mode = await getKeyPreflightMode();
    logger.warn(
      { trigger, mode, failures: keyWarnings },
      "Provider key pre-flight check found failing keys",
    );
    if (mode === "block") {
      const [blockedRun] = await db
        .insert(surveyRunsTable)
        .values({
          status: "failed",
          trigger,
          industryId: industryId ?? null,
          completedAt: new Date(),
          totalQueries: 0,
          keyWarnings,
          error: `Run blocked by pre-flight key check — ${describeKeyFailures(keyWarnings)}`,
        })
        .returning();
      if (!blockedRun) throw new Error("Failed to record blocked survey run");
      return { kind: "blocked", run: blockedRun, failures: keyWarnings };
    }
  }

  const industries = (await db.select().from(industriesTable)).filter(
    (i) => i.enabled && (industryId == null || i.id === industryId),
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

  // Auto-triggered scoped runs with nothing to survey (e.g. industry has no
  // enabled brands yet) are skipped silently rather than recorded as empty runs.
  if (trigger === "auto" && queries.length === 0) {
    logger.info(
      { industryId },
      "Skipping automatic scoped run — no surveyable queries",
    );
    return { kind: "skipped" };
  }

  const [run] = await db
    .insert(surveyRunsTable)
    .values({
      status: "running",
      trigger,
      industryId: industryId ?? null,
      totalQueries: queries.length,
      keyWarnings: keyWarnings.length > 0 ? keyWarnings : null,
    })
    .returning();

  if (!run) {
    throw new Error("Failed to create survey run");
  }

  // Fire and forget — run continues in the background.
  void executeRun(run, queries)
    .catch((err) => {
      logger.error({ err, runId: run.id }, "Survey run crashed");
    })
    .finally(() => {
      runInProgress = false;
      drainPendingAutoRuns();
    });

  return { kind: "started", run };
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

  // Resolve the template once so every query in the run uses the same text.
  const { template } = await getActivePromptTemplate();

  await batchProcess(
    queries,
    async (query) => {
      // Every query is an entirely new, isolated request to the engine.
      const prompt = buildPrompt(query, template);
      let raw: string | null = null;
      try {
        raw = await callEngine(query.engine, prompt);
        const { entries, trend } = parseResponse(query, raw);
        await db.insert(surveyResponsesTable).values({
          runId: run.id,
          engineId: query.engine.id,
          industryId: query.industry.id,
          metricKey: query.metric.key,
          status: "ok",
          entries,
          trend,
          prompt,
          rawResponse: raw,
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
          prompt,
          rawResponse: raw,
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

  if (succeeded > 0) {
    try {
      await detectAlertsForRun(run);
    } catch (err) {
      logger.error({ err, runId: run.id }, "Alert detection failed");
    }
  }
}
