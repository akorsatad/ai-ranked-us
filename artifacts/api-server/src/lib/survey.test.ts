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
  runInserts: { trigger: string; industryId: number | null }[];
  insertShouldFail: boolean;
  nextRunId: number;
}

const state: MockState = {
  engines: [],
  industries: [],
  brands: [],
  runInserts: [],
  insertShouldFail: false,
  nextRunId: 1,
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
  const industriesTable = { __t: "industries" };
  const brandsTable = { __t: "brands" };
  const surveyRunsTable = { __t: "survey_runs" };
  const surveyResponsesTable = { __t: "survey_responses" };
  const db = {
    select: () => ({
      from: (table: unknown) => {
        if (table === enginesTable) return Promise.resolve(state.engines);
        if (table === industriesTable) return Promise.resolve(state.industries);
        if (table === brandsTable) return Promise.resolve(state.brands);
        return Promise.resolve([]);
      },
    }),
    insert: (table: unknown) => ({
      values: (v: Record<string, unknown>) => {
        const exec = async () => {
          if (table === surveyRunsTable) {
            if (state.insertShouldFail) throw new Error("insert failed");
            const row = {
              id: state.nextRunId++,
              status: "running",
              trigger: v.trigger,
              industryId: v.industryId ?? null,
              startedAt: new Date(0),
              completedAt: null,
              error: null,
              totalQueries: v.totalQueries ?? 0,
              succeededQueries: 0,
              failedQueries: 0,
            };
            state.runInserts.push({
              trigger: String(v.trigger),
              industryId: (v.industryId as number | null) ?? null,
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
    industriesTable,
    brandsTable,
    surveyRunsTable,
    surveyResponsesTable,
  };
});

vi.mock("@workspace/integrations-openai-ai-server/batch", () => ({
  batchProcess: async () => {
    await batchGate;
  },
}));

vi.mock("./engineClients", () => ({ callEngine: async () => "{}" }));
vi.mock("./alerts", () => ({ detectAlertsForRun: async () => undefined }));

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
  releaseBatch = null;
  batchGate = Promise.resolve();
});

describe("startSurveyRun lock handling", () => {
  it("skips an auto run with no surveyable queries and releases the lock", async () => {
    // No brands at all — an auto scoped run has nothing to do.
    state.industries = [{ id: 5, slug: "empty", enabled: true }];
    const run = await startSurveyRun("auto", 5);
    expect(run).toBeNull();
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
    const run = await startSurveyRun("manual");
    expect(run).not.toBeNull();
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
    expect(first).not.toBeNull();
    expect(isRunInProgress()).toBe(true);

    // Requested while the manual run is active — must be queued, not dropped.
    requestAutoScopedRun(2);
    expect(state.runInserts).toHaveLength(1);

    // Finish the active run; the queued auto run should start automatically.
    releaseBatch?.();
    await vi.waitFor(() => {
      expect(state.runInserts).toHaveLength(2);
    });
    expect(state.runInserts[1]).toEqual({ trigger: "auto", industryId: 2 });
    await vi.waitFor(() => expect(isRunInProgress()).toBe(false));
  });

  it("starts an auto run immediately when no run is active", async () => {
    seedSurveyable(3);
    requestAutoScopedRun(3);
    await vi.waitFor(() => {
      expect(state.runInserts).toHaveLength(1);
    });
    expect(state.runInserts[0]).toEqual({ trigger: "auto", industryId: 3 });
    await vi.waitFor(() => expect(isRunInProgress()).toBe(false));
  });
});
