import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Focused tests for the survey-run lock + automatic scoped-run queue:
 * - an auto run with nothing to survey is skipped and releases the lock
 * - a setup failure (e.g. DB insert error) releases the lock
 * - an auto run requested while another run is active is queued, then
 *   started as soon as the active run finishes
 */

interface MockState {
  engines: unknown[];
  industries: unknown[];
  brands: unknown[];
  runInserts: {
    trigger: string;
    industryId: number | null;
    status?: string;
    keyWarnings?: unknown;
    error?: unknown;
  }[];
  insertShouldFail: boolean;
  nextRunId: number;
  preflightFailures: { provider: string; source: string; error: string }[];
  preflightMode: "warn" | "block";
}

const state: MockState = {
  engines: [],
  industries: [],
  brands: [],
  runInserts: [],
  insertShouldFail: false,
  nextRunId: 1,
  preflightFailures: [],
  preflightMode: "warn",
};

// Gate that the mocked batchProcess awaits, letting tests hold a run "in
// progress" until they choose to finish it.
let releaseBatch: (() => void) | null = null;
let batchGate: Promise<void> = Promise.resolve();

function holdNextBatch(): void {
  batchGate = new Promise((resolve) => {
    releaseBatch = resolve;
  });
}

vi.mock("@workspace/db", () => {
  const enginesTable = { __t: "engines" };
  const engineModelsTable = { __t: "engine_models" };
  const industriesTable = { __t: "industries" };
  const brandsTable = { __t: "brands" };
  const surveyRunsTable = { __t: "survey_runs" };
  const surveyResponsesTable = { __t: "survey_responses" };
  const appSettingsTable = { __t: "app_settings" };
  const providerApiKeysTable = { __t: "provider_api_keys" };
  const db = {
    select: () => ({
      from: (table: unknown) => {
        let rows: unknown[] = [];
        if (table === enginesTable) rows = state.engines;
        if (table === industriesTable) rows = state.industries;
        if (table === brandsTable) rows = state.brands;
        // Support both `await from(...)` and `from(...).where(...)` chains.
        return Object.assign(Promise.resolve(rows), {
          where: () => Promise.resolve(rows),
        });
      },
    }),
    insert: (table: unknown) => ({
      values: (v: Record<string, unknown>) => {
        const exec = async () => {
          if (table === surveyRunsTable) {
            if (state.insertShouldFail) throw new Error("insert failed");
            const row = {
              id: state.nextRunId++,
              status: v.status ?? "running",
              trigger: v.trigger,
              industryId: v.industryId ?? null,
              startedAt: new Date(0),
              completedAt: null,
              error: v.error ?? null,
              totalQueries: v.totalQueries ?? 0,
              succeededQueries: 0,
              failedQueries: 0,
              keyWarnings: v.keyWarnings ?? null,
            };
            state.runInserts.push({
              trigger: String(v.trigger),
              industryId: (v.industryId as number | null) ?? null,
              status: String(v.status ?? "running"),
              keyWarnings: v.keyWarnings ?? null,
              error: v.error ?? null,
            });
            return [row];
          }
          return [{ ...v, id: 1 }];
        };
        return {
          returning: exec,
          then: (onOk: (v: unknown) => unknown, onErr?: (e: unknown) => unknown) =>
            exec().then(onOk, onErr),
        };
      },
    }),
    update: () => ({ set: () => ({ where: () => Promise.resolve() }) }),
  };
  return {
    db,
    enginesTable,
    engineModelsTable,
    industriesTable,
    brandsTable,
    surveyRunsTable,
    surveyResponsesTable,
    appSettingsTable,
    providerApiKeysTable,
  };
});

vi.mock("@workspace/integrations-openai-ai-server/batch", () => ({
  batchProcess: async () => {
    await batchGate;
  },
}));

vi.mock("./engineClients", () => ({ callEngine: async () => "{}" }));
vi.mock("./alerts", () => ({ detectAlertsForRun: async () => undefined }));
vi.mock("./apiKeys", () => ({
  isProvider: () => true,
  preflightProviderKeys: async () => state.preflightFailures,
  getKeyPreflightMode: async () => state.preflightMode,
}));

import { startSurveyRun, isRunInProgress, requestAutoScopedRun } from "./survey";

function seedSurveyable(industryId = 1): void {
  state.engines = [{ id: 1, key: "e", enabled: true }];
  state.industries = [
    { id: industryId, slug: `ind-${industryId}`, enabled: true },
  ];
  state.brands = [
    { id: 1, industryId, name: "Brand", enabled: true },
  ];
}

beforeEach(() => {
  state.engines = [];
  state.industries = [];
  state.brands = [];
  state.runInserts = [];
  state.insertShouldFail = false;
  state.nextRunId = 1;
  state.preflightFailures = [];
  state.preflightMode = "warn";
  releaseBatch = null;
  batchGate = Promise.resolve();
});

describe("startSurveyRun lock handling", () => {
  it("skips an auto run with no surveyable queries and releases the lock", async () => {
    // No brands at all — an auto scoped run has nothing to do.
    state.industries = [{ id: 5, slug: "empty", enabled: true }];
    const result = await startSurveyRun("auto", 5);
    expect(result.kind).toBe("skipped");
    expect(isRunInProgress()).toBe(false);
    expect(state.runInserts).toHaveLength(0);
  });

  it("releases the lock when run setup fails", async () => {
    seedSurveyable();
    state.insertShouldFail = true;
    await expect(startSurveyRun("manual")).rejects.toThrow("insert failed");
    expect(isRunInProgress()).toBe(false);
    // A subsequent run can start again.
    state.insertShouldFail = false;
    const result = await startSurveyRun("manual");
    expect(result.kind).toBe("started");
    await vi.waitFor(() => expect(isRunInProgress()).toBe(false));
  });
});

describe("provider key pre-flight check", () => {
  const failure = {
    provider: "openai",
    source: "stored",
    error: "401 invalid key",
  };

  it("starts the run but records key warnings in warn mode", async () => {
    seedSurveyable();
    state.preflightFailures = [failure];
    state.preflightMode = "warn";

    const result = await startSurveyRun("manual");
    expect(result.kind).toBe("started");
    expect(state.runInserts).toHaveLength(1);
    expect(state.runInserts[0]?.status).toBe("running");
    expect(state.runInserts[0]?.keyWarnings).toEqual([failure]);
    await vi.waitFor(() => expect(isRunInProgress()).toBe(false));
  });

  it("refuses to start and records a failed run in block mode", async () => {
    seedSurveyable();
    state.preflightFailures = [failure];
    state.preflightMode = "block";

    const result = await startSurveyRun("manual");
    expect(result.kind).toBe("blocked");
    if (result.kind === "blocked") {
      expect(result.failures).toEqual([failure]);
    }
    expect(isRunInProgress()).toBe(false);
    expect(state.runInserts).toHaveLength(1);
    expect(state.runInserts[0]?.status).toBe("failed");
    expect(state.runInserts[0]?.keyWarnings).toEqual([failure]);
    expect(String(state.runInserts[0]?.error)).toContain("openai");
    // A later run with fixed keys starts normally.
    state.preflightFailures = [];
    const retry = await startSurveyRun("manual");
    expect(retry.kind).toBe("started");
    await vi.waitFor(() => expect(isRunInProgress()).toBe(false));
  });

  it("does not block runs when all keys pass, even in block mode", async () => {
    seedSurveyable();
    state.preflightMode = "block";
    const result = await startSurveyRun("manual");
    expect(result.kind).toBe("started");
    expect(state.runInserts[0]?.keyWarnings).toBeNull();
    await vi.waitFor(() => expect(isRunInProgress()).toBe(false));
  });
});

describe("automatic scoped run queueing", () => {
  it("queues an auto run while another run is active and starts it afterwards", async () => {
    state.engines = [{ id: 1, key: "e", enabled: true }];
    state.industries = [
      { id: 1, slug: "one", enabled: true },
      { id: 2, slug: "two", enabled: true },
    ];
    state.brands = [
      { id: 1, industryId: 1, name: "A", enabled: true },
      { id: 2, industryId: 2, name: "B", enabled: true },
    ];

    holdNextBatch();
    const first = await startSurveyRun("manual", 1);
    expect(first.kind).toBe("started");
    expect(isRunInProgress()).toBe(true);

    // Requested while the manual run is active — must be queued, not dropped.
    requestAutoScopedRun(2);
    expect(state.runInserts).toHaveLength(1);

    // Finish the active run; the queued auto run should start automatically.
    releaseBatch?.();
    await vi.waitFor(() => {
      expect(state.runInserts).toHaveLength(2);
    });
    expect(state.runInserts[1]).toMatchObject({ trigger: "auto", industryId: 2 });
    await vi.waitFor(() => expect(isRunInProgress()).toBe(false));
  });

  it("starts an auto run immediately when no run is active", async () => {
    seedSurveyable(3);
    requestAutoScopedRun(3);
    await vi.waitFor(() => {
      expect(state.runInserts).toHaveLength(1);
    });
    expect(state.runInserts[0]).toMatchObject({ trigger: "auto", industryId: 3 });
    await vi.waitFor(() => expect(isRunInProgress()).toBe(false));
  });
});
