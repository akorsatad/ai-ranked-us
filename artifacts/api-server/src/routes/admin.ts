import { Router, type IRouter } from "express";
import { eq, desc, count, and, type SQL } from "drizzle-orm";
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
} from "@workspace/api-zod";
import {
  PROVIDERS,
  type Provider,
  apiKeyStatus,
  setStoredApiKey,
} from "../lib/settings";

const router: IRouter = Router();

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

router.get("/admin/catalog", async (_req, res): Promise<void> => {
  const [industries, brands, engines] = await Promise.all([
    db.select().from(industriesTable),
    db.select().from(brandsTable),
    db.select().from(enginesTable),
  ]);
  res.status(200).json({ industries, brands, engines });
  return;
});

router.post("/admin/industries", async (req, res): Promise<void> => {
  const body = CreateIndustryBody.safeParse(req.body);
  if (!body.success || !body.data.name.trim()) {
    res.status(400).json({ message: "Industry name is required" });
    return;
  }
  const [row] = await db
    .insert(industriesTable)
    .values({
      name: body.data.name.trim(),
      slug: slugify(body.data.name),
      country: body.data.country ?? "US",
    })
    .returning();
  res.status(201).json(row);
  return;
});

router.patch(
  "/admin/industries/:industryId",
  async (req, res): Promise<void> => {
    const id = Number(req.params["industryId"]);
    const body = UpdateIndustryBody.safeParse(req.body);
    if (!Number.isInteger(id) || !body.success) {
      res.status(400).json({ message: "Invalid input" });
      return;
    }
    const updates: Partial<{ name: string; enabled: boolean }> = {};
    if (body.data.name !== undefined) updates.name = body.data.name.trim();
    if (body.data.enabled !== undefined) updates.enabled = body.data.enabled;
    if (Object.keys(updates).length === 0) {
      res.status(400).json({ message: "Nothing to update" });
      return;
    }
    const [row] = await db
      .update(industriesTable)
      .set(updates)
      .where(eq(industriesTable.id, id))
      .returning();
    if (!row) {
      res.status(404).json({ message: "Industry not found" });
      return;
    }
    res.status(200).json(row);
    return;
  },
);

router.post("/admin/brands", async (req, res): Promise<void> => {
  const body = CreateBrandBody.safeParse(req.body);
  if (!body.success || !body.data.name.trim()) {
    res.status(400).json({ message: "Brand name and industry are required" });
    return;
  }
  const [industry] = await db
    .select()
    .from(industriesTable)
    .where(eq(industriesTable.id, body.data.industryId));
  if (!industry) {
    res.status(400).json({ message: "Industry not found" });
    return;
  }
  const [row] = await db
    .insert(brandsTable)
    .values({ industryId: body.data.industryId, name: body.data.name.trim() })
    .returning();
  res.status(201).json(row);
  return;
});

router.patch("/admin/brands/:brandId", async (req, res): Promise<void> => {
  const id = Number(req.params["brandId"]);
  const body = UpdateBrandBody.safeParse(req.body);
  if (!Number.isInteger(id) || !body.success) {
    res.status(400).json({ message: "Invalid input" });
    return;
  }
  const updates: Partial<{ name: string; enabled: boolean }> = {};
  if (body.data.name !== undefined) updates.name = body.data.name.trim();
  if (body.data.enabled !== undefined) updates.enabled = body.data.enabled;
  if (Object.keys(updates).length === 0) {
    res.status(400).json({ message: "Nothing to update" });
    return;
  }
  const [row] = await db
    .update(brandsTable)
    .set(updates)
    .where(eq(brandsTable.id, id))
    .returning();
  if (!row) {
    res.status(404).json({ message: "Brand not found" });
    return;
  }
  res.status(200).json(row);
  return;
});

router.post("/admin/engines", async (req, res): Promise<void> => {
  const body = CreateEngineBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ message: "Invalid engine input" });
    return;
  }
  const existing = await db
    .select()
    .from(enginesTable)
    .where(eq(enginesTable.key, body.data.key));
  if (existing.length > 0) {
    res.status(400).json({ message: "An engine with this key already exists" });
    return;
  }
  const [row] = await db.insert(enginesTable).values(body.data).returning();
  res.status(201).json(row);
  return;
});

router.patch("/admin/engines/:engineId", async (req, res): Promise<void> => {
  const id = Number(req.params["engineId"]);
  const body = UpdateEngineBody.safeParse(req.body);
  if (!Number.isInteger(id) || !body.success) {
    res.status(400).json({ message: "Invalid input" });
    return;
  }
  const updates: Partial<{
    name: string;
    vendor: string;
    model: string;
    enabled: boolean;
  }> = {};
  if (body.data.name !== undefined) updates.name = body.data.name;
  if (body.data.vendor !== undefined) updates.vendor = body.data.vendor;
  if (body.data.model !== undefined) updates.model = body.data.model;
  if (body.data.enabled !== undefined) updates.enabled = body.data.enabled;
  if (Object.keys(updates).length === 0) {
    res.status(400).json({ message: "Nothing to update" });
    return;
  }
  const [row] = await db
    .update(enginesTable)
    .set(updates)
    .where(eq(enginesTable.id, id))
    .returning();
  if (!row) {
    res.status(404).json({ message: "Engine not found" });
    return;
  }
  res.status(200).json(row);
  return;
});

router.get("/admin/api-keys", async (_req, res): Promise<void> => {
  const statuses = await Promise.all(PROVIDERS.map((p) => apiKeyStatus(p)));
  res.status(200).json(statuses);
  return;
});

router.put("/admin/api-keys/:provider", async (req, res): Promise<void> => {
  const provider = req.params["provider"] as Provider;
  if (!PROVIDERS.includes(provider)) {
    res.status(400).json({ message: `Unknown provider: ${provider}` });
    return;
  }
  const body = SetApiKeyBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ message: "apiKey is required" });
    return;
  }
  await setStoredApiKey(provider, body.data.apiKey.trim());
  res.status(200).json(await apiKeyStatus(provider));
  return;
});

const TABLES = {
  industries: { table: industriesTable, idCol: industriesTable.id },
  brands: { table: brandsTable, idCol: brandsTable.id },
  engines: { table: enginesTable, idCol: enginesTable.id },
  survey_runs: { table: surveyRunsTable, idCol: surveyRunsTable.id },
  survey_responses: {
    table: surveyResponsesTable,
    idCol: surveyResponsesTable.id,
  },
} as const;

router.get("/admin/data/:table", async (req, res): Promise<void> => {
  const tableName = req.params["table"] as keyof typeof TABLES;
  const def = TABLES[tableName];
  if (!def) {
    res.status(400).json({ message: `Unknown table: ${tableName}` });
    return;
  }
  const page = Math.max(1, Number(req.query["page"]) || 1);
  const pageSize = Math.min(100, Math.max(1, Number(req.query["pageSize"]) || 25));

  const filters: SQL[] = [];
  if (tableName === "brands" && req.query["industryId"]) {
    filters.push(eq(brandsTable.industryId, Number(req.query["industryId"])));
  }
  if (tableName === "survey_runs" && req.query["status"]) {
    filters.push(eq(surveyRunsTable.status, String(req.query["status"])));
  }
  if (tableName === "survey_responses") {
    if (req.query["industryId"])
      filters.push(
        eq(surveyResponsesTable.industryId, Number(req.query["industryId"])),
      );
    if (req.query["engineId"])
      filters.push(
        eq(surveyResponsesTable.engineId, Number(req.query["engineId"])),
      );
    if (req.query["runId"])
      filters.push(eq(surveyResponsesTable.runId, Number(req.query["runId"])));
    if (req.query["metric"])
      filters.push(
        eq(surveyResponsesTable.metricKey, String(req.query["metric"])),
      );
    if (req.query["status"])
      filters.push(eq(surveyResponsesTable.status, String(req.query["status"])));
  }
  const where = filters.length > 0 ? and(...filters) : undefined;

  const countQuery = db.select({ value: count() }).from(def.table);
  const rowsQuery = db.select().from(def.table);
  const [totalRow] = where ? await countQuery.where(where) : await countQuery;
  const rows = await (where ? rowsQuery.where(where) : rowsQuery)
    .orderBy(desc(def.idCol))
    .limit(pageSize)
    .offset((page - 1) * pageSize);

  res.status(200).json({
    rows,
    total: totalRow?.value ?? 0,
    page,
    pageSize,
  });
  return;
});

export default router;
