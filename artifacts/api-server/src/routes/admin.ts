import { Router, type IRouter } from "express";
import { and, desc, eq, ilike, or, sql, type SQL } from "drizzle-orm";
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
} from "@workspace/api-zod";
import {
  isProvider,
  keyStatuses,
  setStoredKey,
  deleteStoredKey,
  statusFor,
} from "../lib/apiKeys";

const router: IRouter = Router();

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
  const [row] = await db
    .insert(industriesTable)
    .values({ name: name.trim(), slug: finalSlug, country: country ?? "US" })
    .returning();
  res.status(201).json(row);
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
  const [row] = await db
    .update(industriesTable)
    .set(parsed.data)
    .where(eq(industriesTable.id, id))
    .returning();
  if (!row) {
    res.status(404).json({ message: "Industry not found" });
    return;
  }
  res.status(200).json(row);
});

// ---------- Brands ----------

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
  const [row] = await db
    .insert(brandsTable)
    .values({
      industryId: parsed.data.industryId,
      name: parsed.data.name.trim(),
    })
    .returning();
  res.status(201).json(row);
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
  const [row] = await db
    .update(brandsTable)
    .set(parsed.data)
    .where(eq(brandsTable.id, id))
    .returning();
  if (!row) {
    res.status(404).json({ message: "Brand not found" });
    return;
  }
  res.status(200).json(row);
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

export default router;
