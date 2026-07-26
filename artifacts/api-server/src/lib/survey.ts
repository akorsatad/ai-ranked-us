import { eq, inArray } from "drizzle-orm";
import {
  db,
  industriesTable,
  brandsTable,
  enginesTable,
  engineModelsTable,
  surveyRunsTable,
  surveyResponsesTable,
  type BrandRow,
  type EngineRow,
  type EngineModelRow,
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
import { detectOutliers } from "./outliers";
import { recordSeriesForResponse } from "./series";
import { estimateCostUsd } from "./pricing";
import { logger } from "./logger";

let runInProgress = false;
let activeRunId: number | null = null;

/** Statuses that represent an in-flight (not yet terminal) run. */
const ACTIVE_RUN_STATUSES = ["running", "pausing", "cancelling"] as const;

/**
 * A run is considered dead if its heartbeat (or, for legacy rows, its start
 * time) has gone silent for longer than this. Well above the longest a single
 * batch of in-flight engine calls can take, so a genuinely alive run is never
 * finalized out from under itself. Overridable via STALE_RUN_MS.
 */
export const STALE_RUN_MS = (() => {
  const raw = Number(process.env.STALE_RUN_MS);
  return Number.isFinite(raw) && raw >= 60_000 ? raw : 10 * 60_000;
})();

/**
 * Bring one run to a terminal state using the responses actually stored for
 * it as the source of truth (rather than trusting in-memory counters that a
 * crash may have lost). Used by both the restart sweep and the watchdog so a
 * run can never be stuck non-terminal.
 */
async function finalizeRunFromResponses(
  run: SurveyRunRow,
  reason: string,
): Promise<{ status: string; succeeded: number; failed: number }> {
  const rows = await db
    .select({ status: surveyResponsesTable.status })
    .from(surveyResponsesTable)
    .where(eq(surveyResponsesTable.runId, run.id));
  const succeeded = rows.filter((r) => r.status === "ok").length;
  const failed = rows.length - succeeded;
  const status =
    succeeded > 0 ? (failed > 0 ? "partial" : "completed") : "failed";
  await db
    .update(surveyRunsTable)
    .set({
      status,
      completedAt: new Date(),
      succeededQueries: succeeded,
      failedQueries: failed,
      error: succeeded > 0 ? run.error : reason,
    })
    .where(eq(surveyRunsTable.id, run.id));
  logger.warn(
    { runId: run.id, status, succeeded, failed, reason },
    "Finalized survey run",
  );
  return { status, succeeded, failed };
}

/**
 * Finalize any run left in an active state (e.g. after a server restart
 * interrupted it), so nothing shows as in-progress forever. Counts are
 * reconciled from stored responses. Call once on server startup, before any
 * new run can begin.
 */
export async function failInterruptedRuns(): Promise<void> {
  const interrupted = await db
    .select()
    .from(surveyRunsTable)
    .where(inArray(surveyRunsTable.status, [...ACTIVE_RUN_STATUSES]));
  for (const run of interrupted) {
    await finalizeRunFromResponses(run, "Interrupted by server restart");
  }
  if (interrupted.length > 0) {
    logger.warn(
      { runIds: interrupted.map((r) => r.id) },
      "Finalized interrupted survey runs after restart",
    );
  }
}

/**
 * Watchdog: finalize runs whose heartbeat has gone stale (the owning loop
 * died without writing a terminal status). A run still being worked — by this
 * process or a serverless cron continuation — heartbeats continuously and is
 * left untouched. Returns the number of runs finalized.
 */
export async function reconcileStaleRuns(
  maxStaleMs: number = STALE_RUN_MS,
): Promise<number> {
  const cutoff = Date.now() - maxStaleMs;
  const candidates = await db
    .select()
    .from(surveyRunsTable)
    .where(inArray(surveyRunsTable.status, [...ACTIVE_RUN_STATUSES]));
  let finalized = 0;
  for (const run of candidates) {
    const beat = (run.heartbeatAt ?? run.startedAt).getTime();
    if (beat > cutoff) continue; // still alive
    await finalizeRunFromResponses(
      run,
      `Finalized by watchdog — no heartbeat for over ${Math.round(maxStaleMs / 60_000)} min`,
    );
    finalized++;
  }
  return finalized;
}

export function isRunInProgress(): boolean {
  return runInProgress;
}

export function getActiveRunId(): number | null {
  return runInProgress ? activeRunId : null;
}

// In-memory control signals for active runs, keyed by run id. Backed by a DB
// status check inside the run loop so a signal also takes effect if it was
// recorded in the DB (e.g. status set to "pausing"/"cancelling").
type ControlSignal = "pause" | "cancel";
const runControls = new Map<number, ControlSignal>();

export function signalRun(runId: number, signal: ControlSignal): void {
  // Cancel always wins over pause.
  if (runControls.get(runId) === "cancel") return;
  runControls.set(runId, signal);
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

/**
 * Startup recovery for queued automatic scoped runs lost to a restart.
 * The in-memory queue (pendingAutoRunIndustryIds) does not survive a server
 * restart, so on boot we detect enabled industries that have enabled brands
 * but no survey responses at all — exactly the state a new industry is left
 * in when its queued auto run never got to start — and request an auto run
 * for each. Idempotent: industries that already have any responses are
 * untouched.
 */
export async function recoverPendingAutoRuns(): Promise<void> {
  const industries = (await db.select().from(industriesTable)).filter(
    (i) => i.enabled,
  );
  const brands = (await db.select().from(brandsTable)).filter(
    (b) => b.enabled,
  );
  const respondedIndustryIds = new Set(
    (
      await db
        .selectDistinct({ industryId: surveyResponsesTable.industryId })
        .from(surveyResponsesTable)
    ).map((r) => r.industryId),
  );

  for (const industry of industries) {
    if (respondedIndustryIds.has(industry.id)) continue;
    if (!brands.some((b) => b.industryId === industry.id)) continue;
    logger.info(
      { industryId: industry.id, slug: industry.slug },
      "Recovering automatic scoped survey run lost to a restart",
    );
    requestAutoScopedRun(industry.id);
  }
}

type QueryType = "current" | "trend";
export type QueryScope = "current" | "trend" | "both";

function scopeIncludes(scope: QueryScope, type: QueryType): boolean {
  return scope === "both" || scope === type;
}

interface SurveyQuery {
  engine: EngineRow;
  engineModel: EngineModelRow;
  industry: IndustryRow;
  brands: BrandRow[];
  metric: MetricDef;
  queryType: QueryType;
}

/**
 * Loads the enabled models for the given engines, keyed by engineId. Engines
 * with no engine_models rows yet (e.g. before the backfill runs) fall back to a
 * synthetic row wrapping the engine's own primary model, so a run always has at
 * least one model to query.
 */
async function loadEnabledModelsByEngine(
  engines: EngineRow[],
): Promise<Map<number, EngineModelRow[]>> {
  const all = await db.select().from(engineModelsTable);
  const byEngine = new Map<number, EngineModelRow[]>();
  for (const m of all) {
    if (!m.enabled) continue;
    const list = byEngine.get(m.engineId) ?? [];
    list.push(m);
    byEngine.set(m.engineId, list);
  }
  for (const engine of engines) {
    const list = byEngine.get(engine.id);
    if (list && list.length > 0) {
      list.sort((a, b) => a.sortOrder - b.sortOrder);
      continue;
    }
    // Fallback synthetic model so the engine still runs on its primary model.
    byEngine.set(engine.id, [
      {
        id: -engine.id, // negative sentinel: not a real row, stored as null
        engineId: engine.id,
        model: engine.model,
        label: null,
        weight: 1,
        enabled: true,
        sortOrder: 0,
      },
    ]);
  }
  return byEngine;
}

import {
  getActivePromptTemplate,
  renderPromptTemplate,
  placeholderValuesFor,
  type PromptKind,
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

function parseRankings(query: SurveyQuery, raw: string): StoredRankingEntry[] {
  const parsed = parseJsonBlock(raw) as {
    rankings?: {
      brand?: string;
      rank?: number;
      score?: number;
      rationale?: string;
    }[];
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
  return entries;
}

function parseTrend(query: SurveyQuery, raw: string): StoredBrandTrend[] {
  const parsed = parseJsonBlock(raw) as {
    trend?: { brand?: string; weekly_scores?: number[] }[];
  };
  if (!Array.isArray(parsed.trend) || parsed.trend.length === 0) {
    throw new Error("Engine response missing trend array");
  }
  const labels = weekLabels();
  const trend: StoredBrandTrend[] = [];
  for (const t of parsed.trend) {
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
  if (trend.length === 0) {
    throw new Error("No trend series matched known brands");
  }
  return trend;
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
  engineId?: number,
  queryScope: QueryScope = "both",
): Promise<StartRunResult> {
  if (runInProgress) return { kind: "in_progress" };
  runInProgress = true;
  activeRunId = null;
  try {
    const result = await beginSurveyRun(trigger, industryId, engineId, queryScope);
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
  engineId?: number,
  queryScope: QueryScope = "both",
): Promise<StartRunResult> {
  const engines = (await db.select().from(enginesTable)).filter(
    (e) => e.enabled && (engineId == null || e.id === engineId),
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
          queryScope,
          industryId: industryId ?? null,
          engineId: engineId ?? null,
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

  const industries = await db.select().from(industriesTable);
  const brands = await db.select().from(brandsTable);
  const modelsByEngine = await loadEnabledModelsByEngine(engines);
  // engines is already filtered to the scoped engine (if any) above.
  const queries = buildAllQueries(
    engines,
    modelsByEngine,
    industries,
    brands,
    industryId,
    queryScope,
  );

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
      queryScope,
      industryId: industryId ?? null,
      engineId: engineId ?? null,
      totalQueries: queries.length,
      keyWarnings: keyWarnings.length > 0 ? keyWarnings : null,
    })
    .returning();

  if (!run) {
    throw new Error("Failed to create survey run");
  }

  // Fire and forget — run continues in the background.
  activeRunId = run.id;
  void executeRun(run, queries)
    .catch((err) => {
      logger.error({ err, runId: run.id }, "Survey run crashed");
    })
    .finally(() => {
      runInProgress = false;
      activeRunId = null;
      runControls.delete(run.id);
      drainPendingAutoRuns();
    });

  return { kind: "started", run };
}

function buildAllQueries(
  engines: EngineRow[],
  modelsByEngine: Map<number, EngineModelRow[]>,
  industries: IndustryRow[],
  brands: BrandRow[],
  industryId?: number | null,
  queryScope: QueryScope = "both",
): SurveyQuery[] {
  const queries: SurveyQuery[] = [];
  for (const engine of engines.filter((e) => e.enabled)) {
    const models = modelsByEngine.get(engine.id) ?? [];
    for (const engineModel of models) {
      for (const industry of industries.filter(
        (i) => i.enabled && (industryId == null || i.id === industryId),
      )) {
        const industryBrands = brands.filter(
          (b) => b.enabled && b.industryId === industry.id,
        );
        if (industryBrands.length === 0) continue;
        for (const metric of METRICS) {
          // Fully isolated calls per (engine, model, industry, metric).
          // "current" is today's ranking (daily); "trend" is the 13-week
          // lookback (weekly), split by scope so daily runs stay cheap.
          if (scopeIncludes(queryScope, "current")) {
            queries.push({
              engine,
              engineModel,
              industry,
              brands: industryBrands,
              metric,
              queryType: "current",
            });
          }
          if (scopeIncludes(queryScope, "trend")) {
            queries.push({
              engine,
              engineModel,
              industry,
              brands: industryBrands,
              metric,
              queryType: "trend",
            });
          }
        }
      }
    }
  }
  return queries;
}

export async function resumeSurveyRun(
  run: SurveyRunRow,
): Promise<{ ok: true } | { ok: false; message: string }> {
  if (runInProgress) {
    return { ok: false, message: "Another survey run is already in progress" };
  }
  runInProgress = true;
  activeRunId = run.id;
  try {
    const allEngines = await db.select().from(enginesTable);
    const engines =
      run.engineId == null
        ? allEngines
        : allEngines.filter((e) => e.id === run.engineId);
    const industries = await db.select().from(industriesTable);
    const brands = await db.select().from(brandsTable);
    const modelsByEngine = await loadEnabledModelsByEngine(engines);
    const allQueries = buildAllQueries(
      engines,
      modelsByEngine,
      industries,
      brands,
      run.industryId,
      (run.queryScope as QueryScope) ?? "both",
    );

    // A synthetic fallback model (id < 0) is stored as a null engineModelId, so
    // normalize both sides of the dedup key to "" for that case.
    const modelPart = (id: number | null): string =>
      id != null && id > 0 ? String(id) : "";

    // Skip queries that already have a stored response (succeeded or failed).
    const existing = await db
      .select({
        engineId: surveyResponsesTable.engineId,
        engineModelId: surveyResponsesTable.engineModelId,
        industryId: surveyResponsesTable.industryId,
        metricKey: surveyResponsesTable.metricKey,
        queryType: surveyResponsesTable.queryType,
        status: surveyResponsesTable.status,
      })
      .from(surveyResponsesTable)
      .where(eq(surveyResponsesTable.runId, run.id));
    const done = new Set(
      existing.map(
        (r) =>
          `${r.engineId}:${modelPart(r.engineModelId)}:${r.industryId}:${r.metricKey}:${r.queryType}`,
      ),
    );
    const remaining = allQueries.filter(
      (q) =>
        !done.has(
          `${q.engine.id}:${modelPart(q.engineModel.id)}:${q.industry.id}:${q.metric.key}:${q.queryType}`,
        ),
    );
    const succeededSoFar = existing.filter((r) => r.status === "ok").length;
    const failedSoFar = existing.length - succeededSoFar;

    runControls.delete(run.id);
    await db
      .update(surveyRunsTable)
      .set({
        status: "running",
        error: null,
        totalQueries: existing.length + remaining.length,
        succeededQueries: succeededSoFar,
        failedQueries: failedSoFar,
      })
      .where(eq(surveyRunsTable.id, run.id));

    logger.info(
      { runId: run.id, remaining: remaining.length },
      "Survey run resumed",
    );
    void executeRun(run, remaining, {
      initialSucceeded: succeededSoFar,
      initialFailed: failedSoFar,
    })
      .catch((err) => {
        logger.error({ err, runId: run.id }, "Resumed survey run crashed");
      })
      .finally(() => {
        runInProgress = false;
        activeRunId = null;
        runControls.delete(run.id);
      });
    return { ok: true };
  } catch (err) {
    runInProgress = false;
    activeRunId = null;
    throw err;
  }
}

async function executeRun(
  run: SurveyRunRow,
  queries: SurveyQuery[],
  opts: { initialSucceeded?: number; initialFailed?: number } = {},
): Promise<void> {
  logger.info(
    { runId: run.id, totalQueries: queries.length },
    "Survey run started",
  );
  let succeeded = opts.initialSucceeded ?? 0;
  let failed = opts.initialFailed ?? 0;
  let skipped = 0;

  // Signal check: in-memory map first, then a throttled DB status check so a
  // signal recorded only in the DB still takes effect.
  let lastDbCheck = 0;
  const getSignal = async (): Promise<ControlSignal | null> => {
    const local = runControls.get(run.id);
    if (local) return local;
    const now = Date.now();
    if (now - lastDbCheck < 2000) return null;
    lastDbCheck = now;
    const [row] = await db
      .select({ status: surveyRunsTable.status })
      .from(surveyRunsTable)
      .where(eq(surveyRunsTable.id, run.id));
    if (row?.status === "pausing") {
      signalRun(run.id, "pause");
      return "pause";
    }
    if (row?.status === "cancelling") {
      signalRun(run.id, "cancel");
      return "cancel";
    }
    return null;
  };
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let totalCostUsd = 0;

  // Live progress + heartbeat: persist counters and a heartbeat timestamp as
  // the run advances, throttled so we don't hammer the DB. This is what makes
  // the admin console (and the serverless cron's status poll) show real
  // progress instead of 0/N until the very end, and it is the liveness signal
  // the watchdog uses to tell a working run from a dead one.
  const FLUSH_INTERVAL_MS = 3000;
  let lastFlush = 0;
  const flushProgress = async (force = false): Promise<void> => {
    const now = Date.now();
    if (!force && now - lastFlush < FLUSH_INTERVAL_MS) return;
    lastFlush = now;
    try {
      await db
        .update(surveyRunsTable)
        .set({
          succeededQueries: succeeded,
          failedQueries: failed,
          heartbeatAt: new Date(),
          totalInputTokens,
          totalOutputTokens,
          totalCostUsd: Math.round(totalCostUsd * 1_000_000) / 1_000_000,
        })
        .where(eq(surveyRunsTable.id, run.id));
    } catch (err) {
      logger.warn({ err, runId: run.id }, "Failed to flush run progress");
    }
  };
  // Stamp an initial heartbeat so the run reads as alive from the first moment.
  await flushProgress(true);

  // Resolve both templates once so every query in the run uses the same text.
  const currentTemplate = (await getActivePromptTemplate("current")).template;
  const trendTemplate = (await getActivePromptTemplate("trend")).template;
  const templateFor = (kind: PromptKind): string =>
    kind === "trend" ? trendTemplate : currentTemplate;

  await batchProcess(
    queries,
    async (query) => {
      // Stop dispatching new work once a pause/cancel signal is present.
      if ((await getSignal()) != null) {
        skipped++;
        return null;
      }
      // Every query is an entirely new, isolated request to the engine, for
      // exactly one of the two asks (current ranking OR 13-week trend).
      const prompt = buildPrompt(query, templateFor(query.queryType));
      // Synthetic fallback models use a negative sentinel id — store null.
      const engineModelId =
        query.engineModel.id > 0 ? query.engineModel.id : null;
      let raw: string | null = null;
      try {
        const result = await callEngine(
          query.engine,
          query.engineModel.model,
          prompt,
        );
        raw = result.text;
        const entries =
          query.queryType === "current" ? parseRankings(query, result.text) : null;
        const trend =
          query.queryType === "trend" ? parseTrend(query, result.text) : null;
        const costUsd =
          result.inputTokens != null && result.outputTokens != null
            ? estimateCostUsd(
                result.resolvedModel,
                result.inputTokens,
                result.outputTokens,
              )
            : null;
        totalInputTokens += result.inputTokens ?? 0;
        totalOutputTokens += result.outputTokens ?? 0;
        totalCostUsd += costUsd ?? 0;
        const [inserted] = await db
          .insert(surveyResponsesTable)
          .values({
            runId: run.id,
            engineId: query.engine.id,
            engineModelId,
            industryId: query.industry.id,
            metricKey: query.metric.key,
            queryType: query.queryType,
            status: "ok",
            entries,
            trend,
            prompt,
            rawResponse: raw,
            resolvedModel: result.resolvedModel,
            inputTokens: result.inputTokens,
            outputTokens: result.outputTokens,
            costUsd,
          })
          .returning();
        if (inserted) {
          await recordSeriesForResponse(inserted);
        }
        succeeded++;
        await flushProgress();
      } catch (err) {
        failed++;
        const message = err instanceof Error ? err.message : String(err);
        logger.warn(
          {
            runId: run.id,
            engine: query.engine.key,
            industry: query.industry.slug,
            metric: query.metric.key,
            queryType: query.queryType,
            error: message,
          },
          "Survey query failed",
        );
        await db.insert(surveyResponsesTable).values({
          runId: run.id,
          engineId: query.engine.id,
          engineModelId,
          industryId: query.industry.id,
          metricKey: query.metric.key,
          queryType: query.queryType,
          status: "failed",
          error: message.slice(0, 1000),
          prompt,
          rawResponse: raw,
        });
        await flushProgress();
      }
      return null;
    },
    { concurrency: 4, retries: 2 },
  );

  const signal = runControls.get(run.id) ?? null;
  runControls.delete(run.id);

  let status: string;
  let completedAt: Date | null = new Date();
  if (signal === "cancel") {
    status = "cancelled";
  } else if (signal === "pause") {
    status = "paused";
    completedAt = null;
  } else {
    status = failed === 0 ? "completed" : succeeded === 0 ? "failed" : "partial";
  }

  await db
    .update(surveyRunsTable)
    .set({
      status,
      completedAt,
      succeededQueries: succeeded,
      failedQueries: failed,
      totalInputTokens,
      totalOutputTokens,
      totalCostUsd: Math.round(totalCostUsd * 1_000_000) / 1_000_000,
      error:
        signal == null && succeeded === 0 && failed > 0
          ? "All engine queries failed. Check that AI integrations are provisioned."
          : null,
    })
    .where(eq(surveyRunsTable.id, run.id));
  logger.info(
    { runId: run.id, status, succeeded, failed, skipped },
    "Survey run done",
  );

  if (signal == null && succeeded > 0) {
    try {
      await detectAlertsForRun(run);
    } catch (err) {
      logger.error({ err, runId: run.id }, "Alert detection failed");
    }
    // Statistical outlier detection (±Nσ) + per-engine self-explanation.
    try {
      await detectOutliers(run.id);
    } catch (err) {
      logger.error({ err, runId: run.id }, "Outlier detection failed");
    }
  }
}
