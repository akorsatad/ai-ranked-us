import { Router, type IRouter } from "express";
import { and, desc, eq, gte, ilike, or, sql, type SQL } from "drizzle-orm";
import {
  db,
  industriesTable,
  brandsTable,
  enginesTable,
  surveyRunsTable,
  surveyResponsesTable,
} from "@workspace/db";
import {
  CreateIndustryBody,
  UpdateIndustryBody,
  CreateBrandBody,
  UpdateBrandBody,
  CreateEngineBody,
  UpdateEngineBody,
  SetApiKeyBody,
  BrowseTableQueryParams,
  UpdatePromptTemplateBody,
} from "@workspace/api-zod";
import {
  isProvider,
  keyStatuses,
  setStoredKey,
  deleteStoredKey,
  statusFor,
  testProviderKey,
  getKeyPreflightMode,
  setKeyPreflightMode,
  isKeyPreflightMode,
} from "../lib/apiKeys";
import { getAuth } from "@clerk/express";
import { ensureAdmin, requireAdmin } from "../middlewares/requireAdmin";
import {
  promptTemplateInfo,
  setStoredPromptTemplate,
  clearStoredPromptTemplate,
  missingRequiredPlaceholders,
} from "../lib/promptTemplate";
import { requestAutoScopedRun } from "../lib/survey";
import { getMetric } from "../lib/metrics";
import {
  latestResponsesByEngine,
  averageEntries,
  rankEntries,
} from "../lib/aggregate";

const router: IRouter = Router();

// Everything on this router requires an authenticated admin,
// except /admin/me which reports the caller's admin status.
router.get("/admin/me", async (req, res): Promise<void> => {
  const auth = getAuth(req);
  const userId = auth?.userId;
  if (!userId) {
    res.status(401).json({ message: "Authentication required" });
    return;
  }
  res.status(200).json(await ensureAdmin(userId));
});

router.use(requireAdmin);

/** True when the error is a Postgres unique-constraint violation (23505). */
function isUniqueViolation(err: unknown): boolean {
  let current: unknown = err;
  // Drizzle may wrap the driver error; walk the cause chain.
  for (let depth = 0; depth < 5 && typeof current === "object" && current !== null; depth++) {
    if ((current as { code?: string }).code === "23505") return true;
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function parseId(raw: string | string[] | undefined): number | null {
  const value = Array.isArray(raw) ? raw[0] : raw;
  const id = parseInt(value ?? "", 10);
  return Number.isFinite(id) ? id : null;
}

// ---------- Industries ----------

router.post("/industries", async (req, res): Promise<void> => {
  const parsed = CreateIndustryBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ message: parsed.error.message });
    return;
  }
  const { name, slug, country } = parsed.data;
  const finalSlug = slug?.trim() || slugify(name);
  const [existing] = await db
    .select()
    .from(industriesTable)
    .where(eq(industriesTable.slug, finalSlug));
  if (existing) {
    res
      .status(409)
      .json({ message: `An industry with slug "${finalSlug}" already exists` });
    return;
  }
  try {
    const [row] = await db
      .insert(industriesTable)
      .values({ name: name.trim(), slug: finalSlug, country: country ?? "US" })
      .returning();
    res.status(201).json(row);
  } catch (err) {
    if (isUniqueViolation(err)) {
      res
        .status(409)
        .json({ message: "An industry with this name already exists" });
      return;
    }
    throw err;
  }
});

router.patch("/industries/:id", async (req, res): Promise<void> => {
  const id = parseId(req.params.id);
  if (id === null) {
    res.status(400).json({ message: "Invalid industry id" });
    return;
  }
  const parsed = UpdateIndustryBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ message: parsed.error.message });
    return;
  }
  const update = { ...parsed.data };
  if (update.name !== undefined) {
    update.name = update.name.trim();
    const [conflict] = await db
      .select({ id: industriesTable.id })
      .from(industriesTable)
      .where(
        and(
          sql`lower(${industriesTable.name}) = lower(${update.name})`,
          sql`${industriesTable.id} <> ${id}`,
        ),
      );
    if (conflict) {
      res
        .status(409)
        .json({ message: "An industry with this name already exists" });
      return;
    }
  }
  try {
    const [row] = await db
      .update(industriesTable)
      .set(update)
      .where(eq(industriesTable.id, id))
      .returning();
    if (!row) {
      res.status(404).json({ message: "Industry not found" });
      return;
    }
    res.status(200).json(row);
  } catch (err) {
    if (isUniqueViolation(err)) {
      res
        .status(409)
        .json({ message: "An industry with this name already exists" });
      return;
    }
    throw err;
  }
});

// ---------- Brands ----------

/**
 * If the given (enabled) brand is now the ONLY enabled brand of an enabled
 * industry, request an automatic survey run scoped to that industry so it
 * populates with data right away.
 */
async function maybeAutoSurveyFirstEnabledBrand(
  req: { log: { info: (obj: object, msg: string) => void } },
  industryId: number,
  brandId: number,
): Promise<void> {
  const [industry] = await db
    .select()
    .from(industriesTable)
    .where(eq(industriesTable.id, industryId));
  if (!industry?.enabled) return;
  const [countRow] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(brandsTable)
    .where(
      and(eq(brandsTable.industryId, industryId), eq(brandsTable.enabled, true)),
    );
  if ((countRow?.count ?? 0) !== 1) return;
  req.log.info(
    { industryId, brandId },
    "Industry got its first enabled brand — requesting automatic scoped survey run",
  );
  requestAutoScopedRun(industryId);
}

router.post("/brands", async (req, res): Promise<void> => {
  const parsed = CreateBrandBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ message: parsed.error.message });
    return;
  }
  const [industry] = await db
    .select()
    .from(industriesTable)
    .where(eq(industriesTable.id, parsed.data.industryId));
  if (!industry) {
    res.status(404).json({ message: "Industry not found" });
    return;
  }
  try {
    const [row] = await db
      .insert(brandsTable)
      .values({
        industryId: parsed.data.industryId,
        name: parsed.data.name.trim(),
      })
      .returning();
    // If this is the industry's first enabled brand, kick off an automatic
    // survey run scoped to this industry so it populates with data right away.
    if (row && row.enabled) {
      await maybeAutoSurveyFirstEnabledBrand(
        req,
        parsed.data.industryId,
        row.id,
      );
    }
    res.status(201).json(row);
  } catch (err) {
    if (isUniqueViolation(err)) {
      res
        .status(409)
        .json({ message: "This brand already exists in this industry" });
      return;
    }
    throw err;
  }
});

router.patch("/brands/:id", async (req, res): Promise<void> => {
  const id = parseId(req.params.id);
  if (id === null) {
    res.status(400).json({ message: "Invalid brand id" });
    return;
  }
  const parsed = UpdateBrandBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ message: parsed.error.message });
    return;
  }
  if (parsed.data.industryId !== undefined) {
    const [industry] = await db
      .select()
      .from(industriesTable)
      .where(eq(industriesTable.id, parsed.data.industryId));
    if (!industry) {
      res.status(404).json({ message: "Industry not found" });
      return;
    }
  }
  try {
    const [previous] = await db
      .select()
      .from(brandsTable)
      .where(eq(brandsTable.id, id));
    const [row] = await db
      .update(brandsTable)
      .set(parsed.data)
      .where(eq(brandsTable.id, id))
      .returning();
    if (!row) {
      res.status(404).json({ message: "Brand not found" });
      return;
    }
    // Auto-survey when an industry gains its first enabled brand through this
    // update (brand re-enabled, or an enabled brand moved to a new industry).
    const becameEnabledHere =
      row.enabled &&
      (!previous?.enabled || previous.industryId !== row.industryId);
    if (becameEnabledHere) {
      await maybeAutoSurveyFirstEnabledBrand(req, row.industryId, row.id);
    }
    res.status(200).json(row);
  } catch (err) {
    if (isUniqueViolation(err)) {
      res
        .status(409)
        .json({ message: "This brand already exists in this industry" });
      return;
    }
    throw err;
  }
});

// ---------- Engines ----------

router.get("/engines", async (_req, res): Promise<void> => {
  const engines = await db
    .select()
    .from(enginesTable)
    .orderBy(enginesTable.id);
  res.status(200).json(engines);
});

router.post("/engines", async (req, res): Promise<void> => {
  const parsed = CreateEngineBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ message: parsed.error.message });
    return;
  }
  const key = parsed.data.key.trim();
  const [existing] = await db
    .select()
    .from(enginesTable)
    .where(eq(enginesTable.key, key));
  if (existing) {
    res
      .status(409)
      .json({ message: `An engine with key "${key}" already exists` });
    return;
  }
  const [row] = await db
    .insert(enginesTable)
    .values({
      key,
      name: parsed.data.name.trim(),
      vendor: parsed.data.vendor?.trim() || parsed.data.provider,
      provider: parsed.data.provider,
      model: parsed.data.model.trim(),
    })
    .returning();
  res.status(201).json(row);
});

router.patch("/engines/:id", async (req, res): Promise<void> => {
  const id = parseId(req.params.id);
  if (id === null) {
    res.status(400).json({ message: "Invalid engine id" });
    return;
  }
  const parsed = UpdateEngineBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ message: parsed.error.message });
    return;
  }
  const [row] = await db
    .update(enginesTable)
    .set(parsed.data)
    .where(eq(enginesTable.id, id))
    .returning();
  if (!row) {
    res.status(404).json({ message: "Engine not found" });
    return;
  }
  res.status(200).json(row);
});

// ---------- API keys ----------

router.get("/settings/api-keys", async (_req, res): Promise<void> => {
  res.status(200).json(await keyStatuses());
});

router.put("/settings/api-keys/:provider", async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.provider)
    ? req.params.provider[0]
    : req.params.provider;
  if (!raw || !isProvider(raw)) {
    res.status(400).json({ message: "Unknown provider" });
    return;
  }
  const parsed = SetApiKeyBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ message: "API key must be at least 8 characters" });
    return;
  }
  const row = await setStoredKey(raw, parsed.data.key.trim());
  req.log.info({ provider: raw }, "Provider API key updated");
  res.status(200).json(statusFor(raw, row));
});

router.delete(
  "/settings/api-keys/:provider",
  async (req, res): Promise<void> => {
    const raw = Array.isArray(req.params.provider)
      ? req.params.provider[0]
      : req.params.provider;
    if (!raw || !isProvider(raw)) {
      res.status(400).json({ message: "Unknown provider" });
      return;
    }
    await deleteStoredKey(raw);
    req.log.info({ provider: raw }, "Provider API key removed");
    res.status(200).json(statusFor(raw, null));
  },
);

router.post(
  "/settings/api-keys/:provider/test",
  async (req, res): Promise<void> => {
    const raw = Array.isArray(req.params.provider)
      ? req.params.provider[0]
      : req.params.provider;
    if (!raw || !isProvider(raw)) {
      res.status(400).json({ message: "Unknown provider" });
      return;
    }
    const result = await testProviderKey(raw);
    if (!result) {
      res
        .status(400)
        .json({ message: "No key configured for this provider" });
      return;
    }
    req.log.info(
      { provider: raw, ok: result.ok, source: result.source },
      "Provider API key tested",
    );
    res.status(200).json(result);
  },
);
// ---------- Pre-flight key check setting ----------

router.get("/settings/key-preflight", async (_req, res): Promise<void> => {
  res.status(200).json({ mode: await getKeyPreflightMode() });
});

router.put("/settings/key-preflight", async (req, res): Promise<void> => {
  const mode = (req.body as { mode?: unknown } | undefined)?.mode;
  if (typeof mode !== "string" || !isKeyPreflightMode(mode)) {
    res.status(400).json({ message: "mode must be 'warn' or 'block'" });
    return;
  }
  await setKeyPreflightMode(mode);
  req.log.info({ mode }, "Key pre-flight mode updated");
  res.status(200).json({ mode });
});

// ---------- Survey prompt template ----------

router.get("/admin/prompt-template", async (_req, res): Promise<void> => {
  res.status(200).json(await promptTemplateInfo());
  return;
});

router.put("/admin/prompt-template", async (req, res): Promise<void> => {
  const body = UpdatePromptTemplateBody.safeParse(req.body);
  if (!body.success || !body.data.template.trim()) {
    res.status(400).json({ message: "Template text is required" });
    return;
  }
  const missing = missingRequiredPlaceholders(body.data.template);
  if (missing.length > 0) {
    res.status(400).json({
      message: `Template is missing required placeholders: ${missing
        .map((m) => `{{${m}}}`)
        .join(", ")}`,
    });
    return;
  }
  await setStoredPromptTemplate(body.data.template);
  req.log.info("Survey prompt template updated");
  res.status(200).json(await promptTemplateInfo());
  return;
});

router.delete("/admin/prompt-template", async (req, res): Promise<void> => {
  await clearStoredPromptTemplate();
  req.log.info("Survey prompt template reset to default");
  res.status(200).json(await promptTemplateInfo());
  return;
});

// ---------- Data browser ----------

const BROWSABLE_TABLES = [
  "industries",
  "brands",
  "engines",
  "survey_runs",
  "survey_responses",
] as const;
type BrowsableTable = (typeof BROWSABLE_TABLES)[number];

router.get("/admin/tables/:table", async (req, res): Promise<void> => {
  const rawTable = Array.isArray(req.params.table)
    ? req.params.table[0]
    : req.params.table;
  if (!rawTable || !(BROWSABLE_TABLES as readonly string[]).includes(rawTable)) {
    res.status(400).json({ message: `Unknown table: ${rawTable}` });
    return;
  }
  const table = rawTable as BrowsableTable;

  const query = BrowseTableQueryParams.safeParse(req.query);
  const page = Math.max(1, query.success ? (query.data.page ?? 1) : 1);
  const pageSize = Math.min(
    100,
    Math.max(1, query.success ? (query.data.pageSize ?? 25) : 25),
  );
  const search = query.success ? query.data.search : undefined;
  const industryId = query.success ? query.data.industryId : undefined;
  const runId = query.success ? query.data.runId : undefined;
  const status = query.success ? query.data.status : undefined;
  const offset = (page - 1) * pageSize;

  let columns: string[] = [];
  let rows: Record<string, unknown>[] = [];
  let total = 0;

  switch (table) {
    case "industries": {
      const conditions: SQL[] = [];
      if (search) conditions.push(ilike(industriesTable.name, `%${search}%`));
      const where = conditions.length ? and(...conditions) : undefined;
      const [countRow] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(industriesTable)
        .where(where);
      total = countRow?.count ?? 0;
      const data = await db
        .select()
        .from(industriesTable)
        .where(where)
        .orderBy(industriesTable.id)
        .limit(pageSize)
        .offset(offset);
      columns = ["id", "name", "slug", "country", "enabled"];
      rows = data.map((r) => ({ ...r }));
      break;
    }
    case "brands": {
      const conditions: SQL[] = [];
      if (search) conditions.push(ilike(brandsTable.name, `%${search}%`));
      if (industryId !== undefined)
        conditions.push(eq(brandsTable.industryId, industryId));
      const where = conditions.length ? and(...conditions) : undefined;
      const [countRow] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(brandsTable)
        .where(where);
      total = countRow?.count ?? 0;
      const data = await db
        .select({
          id: brandsTable.id,
          name: brandsTable.name,
          industryId: brandsTable.industryId,
          industryName: industriesTable.name,
          enabled: brandsTable.enabled,
        })
        .from(brandsTable)
        .leftJoin(
          industriesTable,
          eq(brandsTable.industryId, industriesTable.id),
        )
        .where(where)
        .orderBy(brandsTable.id)
        .limit(pageSize)
        .offset(offset);
      columns = ["id", "name", "industryId", "industryName", "enabled"];
      rows = data.map((r) => ({ ...r }));
      break;
    }
    case "engines": {
      const conditions: SQL[] = [];
      if (search)
        conditions.push(
          or(
            ilike(enginesTable.name, `%${search}%`),
            ilike(enginesTable.model, `%${search}%`),
          ) as SQL,
        );
      const where = conditions.length ? and(...conditions) : undefined;
      const [countRow] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(enginesTable)
        .where(where);
      total = countRow?.count ?? 0;
      const data = await db
        .select()
        .from(enginesTable)
        .where(where)
        .orderBy(enginesTable.id)
        .limit(pageSize)
        .offset(offset);
      columns = ["id", "key", "name", "vendor", "provider", "model", "enabled"];
      rows = data.map((r) => ({ ...r }));
      break;
    }
    case "survey_runs": {
      const conditions: SQL[] = [];
      if (status) conditions.push(eq(surveyRunsTable.status, status));
      const where = conditions.length ? and(...conditions) : undefined;
      const [countRow] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(surveyRunsTable)
        .where(where);
      total = countRow?.count ?? 0;
      const data = await db
        .select()
        .from(surveyRunsTable)
        .where(where)
        .orderBy(desc(surveyRunsTable.startedAt))
        .limit(pageSize)
        .offset(offset);
      columns = [
        "id",
        "status",
        "trigger",
        "startedAt",
        "completedAt",
        "totalQueries",
        "succeededQueries",
        "failedQueries",
        "error",
      ];
      rows = data.map((r) => ({
        ...r,
        startedAt: r.startedAt.toISOString(),
        completedAt: r.completedAt ? r.completedAt.toISOString() : null,
      }));
      break;
    }
    case "survey_responses": {
      const conditions: SQL[] = [];
      if (status) conditions.push(eq(surveyResponsesTable.status, status));
      if (runId !== undefined)
        conditions.push(eq(surveyResponsesTable.runId, runId));
      if (industryId !== undefined)
        conditions.push(eq(surveyResponsesTable.industryId, industryId));
      const where = conditions.length ? and(...conditions) : undefined;
      const [countRow] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(surveyResponsesTable)
        .where(where);
      total = countRow?.count ?? 0;
      const data = await db
        .select({
          id: surveyResponsesTable.id,
          runId: surveyResponsesTable.runId,
          engineId: surveyResponsesTable.engineId,
          engineName: enginesTable.name,
          industryId: surveyResponsesTable.industryId,
          industryName: industriesTable.name,
          metricKey: surveyResponsesTable.metricKey,
          status: surveyResponsesTable.status,
          error: surveyResponsesTable.error,
          prompt: surveyResponsesTable.prompt,
          rawResponse: surveyResponsesTable.rawResponse,
          entries: surveyResponsesTable.entries,
          trend: surveyResponsesTable.trend,
          createdAt: surveyResponsesTable.createdAt,
        })
        .from(surveyResponsesTable)
        .leftJoin(
          enginesTable,
          eq(surveyResponsesTable.engineId, enginesTable.id),
        )
        .leftJoin(
          industriesTable,
          eq(surveyResponsesTable.industryId, industriesTable.id),
        )
        .where(where)
        .orderBy(desc(surveyResponsesTable.createdAt))
        .limit(pageSize)
        .offset(offset);
      columns = [
        "id",
        "runId",
        "engineName",
        "industryName",
        "metricKey",
        "status",
        "error",
        "prompt",
        "rawResponse",
        "entries",
        "trend",
        "createdAt",
      ];
      rows = data.map((r) => ({
        ...r,
        createdAt: r.createdAt.toISOString(),
      }));
      break;
    }
  }

  res.status(200).json({ table, page, pageSize, total, columns, rows });
});

interface CostBucketAcc {
  key: string;
  label: string;
  responses: number;
  responsesWithUsage: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  unknownCostResponses: number;
}

function newBucket(key: string, label: string): CostBucketAcc {
  return {
    key,
    label,
    responses: 0,
    responsesWithUsage: 0,
    inputTokens: 0,
    outputTokens: 0,
    costUsd: 0,
    unknownCostResponses: 0,
  };
}

function addToBucket(
  bucket: CostBucketAcc,
  r: {
    inputTokens: number | null;
    outputTokens: number | null;
    costUsd: number | null;
  },
): void {
  bucket.responses += 1;
  if (r.inputTokens != null || r.outputTokens != null) {
    bucket.responsesWithUsage += 1;
    bucket.inputTokens += r.inputTokens ?? 0;
    bucket.outputTokens += r.outputTokens ?? 0;
    if (r.costUsd != null) {
      bucket.costUsd += r.costUsd;
    } else {
      bucket.unknownCostResponses += 1;
    }
  }
}

function roundBucket(bucket: CostBucketAcc): CostBucketAcc {
  return { ...bucket, costUsd: Math.round(bucket.costUsd * 1_000_000) / 1_000_000 };
}

router.get("/admin/costs", async (req, res): Promise<void> => {
  const daysRaw = req.query["days"];
  const days =
    daysRaw !== undefined && Number.isFinite(Number(daysRaw)) && Number(daysRaw) > 0
      ? Number(daysRaw)
      : null;

  const filters: SQL[] = [eq(surveyResponsesTable.status, "ok")];
  if (days !== null) {
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    filters.push(gte(surveyResponsesTable.createdAt, since));
  }

  const [responses, engines, runs] = await Promise.all([
    db
      .select()
      .from(surveyResponsesTable)
      .where(and(...filters)),
    db.select().from(enginesTable),
    db.select().from(surveyRunsTable),
  ]);
  const engineById = new Map(engines.map((e) => [e.id, e]));
  const runById = new Map(runs.map((r) => [r.id, r]));

  const totals = newBucket("total", "Total");
  const byProvider = new Map<string, CostBucketAcc>();
  const byModel = new Map<string, CostBucketAcc>();
  const byRun = new Map<number, CostBucketAcc>();

  for (const r of responses) {
    const engine = engineById.get(r.engineId);
    const provider = engine?.provider ?? "unknown";
    const model = r.resolvedModel ?? engine?.model ?? "unknown";

    addToBucket(totals, r);

    let p = byProvider.get(provider);
    if (!p) byProvider.set(provider, (p = newBucket(provider, provider)));
    addToBucket(p, r);

    const modelKey = `${provider}/${model}`;
    let m = byModel.get(modelKey);
    if (!m) byModel.set(modelKey, (m = newBucket(modelKey, model)));
    addToBucket(m, r);

    let run = byRun.get(r.runId);
    if (!run) byRun.set(r.runId, (run = newBucket(String(r.runId), `Run ${r.runId}`)));
    addToBucket(run, r);
  }

  res.status(200).json({
    days,
    totals: roundBucket(totals),
    byProvider: [...byProvider.values()]
      .map(roundBucket)
      .sort((a, b) => b.costUsd - a.costUsd),
    byModel: [...byModel.values()]
      .map(roundBucket)
      .sort((a, b) => b.costUsd - a.costUsd),
    byRun: [...byRun.entries()]
      .sort((a, b) => b[0] - a[0])
      .map(([runId, bucket]) => {
        const run = runById.get(runId);
        const rounded = roundBucket(bucket);
        return {
          runId,
          startedAt: run ? run.startedAt.toISOString() : "",
          status: run?.status ?? "unknown",
          responses: rounded.responses,
          responsesWithUsage: rounded.responsesWithUsage,
          inputTokens: rounded.inputTokens,
          outputTokens: rounded.outputTokens,
          costUsd: rounded.costUsd,
        };
      }),
  });
  return;
});

router.get("/admin/model-results", async (req, res): Promise<void> => {
  const industryId = Number(req.query["industryId"]);
  const metricKey = String(req.query["metric"] ?? "");
  if (!Number.isInteger(industryId) || !metricKey) {
    res.status(400).json({ message: "industryId and metric are required" });
    return;
  }
  const metric = getMetric(metricKey);
  if (!metric) {
    res.status(400).json({ message: `Unknown metric: ${metricKey}` });
    return;
  }
  const [industry] = await db
    .select()
    .from(industriesTable)
    .where(eq(industriesTable.id, industryId));
  if (!industry) {
    res.status(404).json({ message: "Industry not found" });
    return;
  }

  const responses = await latestResponsesByEngine(industry.id, metric.key);
  res.status(200).json({
    industryId: industry.id,
    industryName: industry.name,
    metric: metric.key,
    metricLabel: metric.label,
    aggregated: averageEntries(
      responses.map((r) => r.response),
      metric.higherIsBetter,
    ),
    byModel: responses.map(({ engine, response }) => ({
      engineId: engine.id,
      engineKey: engine.key,
      engineName: engine.name,
      provider: engine.provider,
      model: engine.model,
      resolvedModel: response.resolvedModel,
      surveyedAt: response.createdAt.toISOString(),
      runId: response.runId,
      inputTokens: response.inputTokens,
      outputTokens: response.outputTokens,
      costUsd: response.costUsd,
      entries: rankEntries(response.entries ?? [], metric.higherIsBetter),
    })),
  });
  return;
});


export default router;
