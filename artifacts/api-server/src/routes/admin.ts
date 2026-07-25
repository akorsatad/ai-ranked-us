import { Router, type IRouter } from "express";
import { and, desc, eq, gte, ilike, isNotNull, or, sql, type SQL } from "drizzle-orm";
import {
  db,
  industriesTable,
  brandsTable,
  enginesTable,
  surveyRunsTable,
  surveyResponsesTable,
  usersTable,
  sessionsTable,
  adHocRequestsTable,
  adminUsersTable,
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
  ListAdminUsersQueryParams,
  UpdateUserStatusBody,
  InviteAdminBody,
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
import { requireAdmin, resolveAdminSession } from "../middlewares/requireAdmin";
import { isGoogleAuthConfigured } from "../lib/authConfig";
import {
  promptTemplateInfo,
  setStoredPromptTemplate,
  clearStoredPromptTemplate,
  missingRequiredPlaceholders,
  isPromptKind,
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
  if (!isGoogleAuthConfigured()) {
    res.status(503).json({
      message:
        "Admin authentication is not configured on this deployment (set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET).",
    });
    return;
  }
  const identity = await resolveAdminSession(req);
  if (!identity) {
    res.status(401).json({ message: "Authentication required" });
    return;
  }
  res.status(200).json({ isAdmin: true, email: identity.email });
});

// Gate ONLY this router's own path prefixes. A bare router.use(requireAdmin)
// would also intercept every router mounted after this one in routes/index.ts
// (alerts, og, auth, rank), admin-gating the entire public API — requests
// flow through unprefixed sub-routers even when no route here matches.
router.use(
  ["/admin", "/industries", "/brands", "/engines", "/settings"],
  requireAdmin,
);

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
  const kind = body.data.kind;
  if (!isPromptKind(kind)) {
    res.status(400).json({ message: "kind must be 'current' or 'trend'" });
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
  await setStoredPromptTemplate(kind, body.data.template);
  req.log.info({ kind }, "Survey prompt template updated");
  res.status(200).json(await promptTemplateInfo());
  return;
});

router.delete("/admin/prompt-template", async (req, res): Promise<void> => {
  const rawKind = req.query.kind;
  if (typeof rawKind !== "string" || !isPromptKind(rawKind)) {
    res.status(400).json({ message: "kind must be 'current' or 'trend'" });
    return;
  }
  await clearStoredPromptTemplate(rawKind);
  req.log.info({ kind: rawKind }, "Survey prompt template reset to default");
  res.status(200).json(await promptTemplateInfo());
  return;
});

// ---------- User management ----------

interface AdminAppUserOut {
  id: number;
  email: string;
  firstName: string;
  lastName: string;
  createdAt: Date;
  disabled: boolean;
  disabledAt: Date | null;
  rankRequests: number;
  lastRequestAt: Date | null;
  activeSessions: number;
}

async function userWithStats(userId: number): Promise<AdminAppUserOut | null> {
  const now = new Date();
  const [row] = await db
    .select({
      id: usersTable.id,
      email: usersTable.email,
      firstName: usersTable.firstName,
      lastName: usersTable.lastName,
      createdAt: usersTable.createdAt,
      disabledAt: usersTable.disabledAt,
      rankRequests: sql<number>`count(distinct ${adHocRequestsTable.id})::int`,
      lastRequestAt: sql<Date | null>`max(${adHocRequestsTable.createdAt})`,
      activeSessions: sql<number>`(count(distinct ${sessionsTable.id}) filter (where ${sessionsTable.expiresAt} > ${now}))::int`,
    })
    .from(usersTable)
    .leftJoin(adHocRequestsTable, eq(adHocRequestsTable.userId, usersTable.id))
    .leftJoin(sessionsTable, eq(sessionsTable.userId, usersTable.id))
    .where(eq(usersTable.id, userId))
    .groupBy(usersTable.id);
  if (!row) return null;
  return { ...row, disabled: row.disabledAt != null };
}

router.get("/admin/users", async (req, res): Promise<void> => {
  const query = ListAdminUsersQueryParams.safeParse(req.query);
  const page = Math.max(1, query.success ? (query.data.page ?? 1) : 1);
  const pageSize = Math.min(
    100,
    Math.max(1, query.success ? (query.data.pageSize ?? 25) : 25),
  );
  const search = query.success ? query.data.search : undefined;
  const offset = (page - 1) * pageSize;

  const where = search
    ? or(
        ilike(usersTable.email, `%${search}%`),
        ilike(usersTable.firstName, `%${search}%`),
        ilike(usersTable.lastName, `%${search}%`),
      )
    : undefined;

  const [countRow] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(usersTable)
    .where(where);
  const total = countRow?.count ?? 0;

  const now = new Date();
  const data = await db
    .select({
      id: usersTable.id,
      email: usersTable.email,
      firstName: usersTable.firstName,
      lastName: usersTable.lastName,
      createdAt: usersTable.createdAt,
      disabledAt: usersTable.disabledAt,
      rankRequests: sql<number>`count(distinct ${adHocRequestsTable.id})::int`,
      lastRequestAt: sql<Date | null>`max(${adHocRequestsTable.createdAt})`,
      activeSessions: sql<number>`(count(distinct ${sessionsTable.id}) filter (where ${sessionsTable.expiresAt} > ${now}))::int`,
    })
    .from(usersTable)
    .leftJoin(adHocRequestsTable, eq(adHocRequestsTable.userId, usersTable.id))
    .leftJoin(sessionsTable, eq(sessionsTable.userId, usersTable.id))
    .where(where)
    .groupBy(usersTable.id)
    .orderBy(desc(usersTable.createdAt))
    .limit(pageSize)
    .offset(offset);

  res.status(200).json({
    users: data.map((r) => ({ ...r, disabled: r.disabledAt != null })),
    total,
    page,
    pageSize,
  });
});

router.patch("/admin/users/:userId", async (req, res): Promise<void> => {
  const userId = Number(req.params.userId);
  if (!Number.isInteger(userId) || userId <= 0) {
    res.status(404).json({ message: "User not found" });
    return;
  }
  const body = UpdateUserStatusBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ message: "disabled (boolean) is required" });
    return;
  }
  const [updated] = await db
    .update(usersTable)
    .set({ disabledAt: body.data.disabled ? new Date() : null })
    .where(eq(usersTable.id, userId))
    .returning({ id: usersTable.id });
  if (!updated) {
    res.status(404).json({ message: "User not found" });
    return;
  }
  if (body.data.disabled) {
    // Revoke every active session so the block takes effect immediately.
    await db.delete(sessionsTable).where(eq(sessionsTable.userId, userId));
  }
  req.log.info(
    { userId, disabled: body.data.disabled },
    "User account status updated",
  );
  res.status(200).json(await userWithStats(userId));
});

// ---------- Admin management ----------

router.get("/admin/admins", async (req, res): Promise<void> => {
  const caller = (req as typeof req & { admin?: { adminUserId: number } })
    .admin;
  const rows = await db
    .select()
    .from(adminUsersTable)
    .orderBy(adminUsersTable.id);
  res.status(200).json({
    admins: rows.map((r) => ({
      id: r.id,
      email: r.email,
      pending: r.externalId == null,
      self: r.id === caller?.adminUserId,
      createdAt: r.createdAt,
    })),
  });
});

router.post("/admin/admins", async (req, res): Promise<void> => {
  const body = InviteAdminBody.safeParse(req.body);
  const email = body.success ? body.data.email.trim().toLowerCase() : "";
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    res.status(400).json({ message: "A valid email address is required" });
    return;
  }
  const existing = await db
    .select()
    .from(adminUsersTable)
    .where(sql`lower(${adminUsersTable.email}) = ${email}`);
  if (existing[0]) {
    res.status(409).json({
      message: existing[0].externalId
        ? "This email already belongs to an admin"
        : "This email already has a pending invite",
    });
    return;
  }
  const [row] = await db
    .insert(adminUsersTable)
    .values({ email })
    .returning();
  if (!row) {
    res.status(500).json({ message: "Failed to create invite" });
    return;
  }
  req.log.info({ email }, "Admin invited");
  res.status(201).json({
    id: row.id,
    email: row.email,
    pending: true,
    self: false,
    createdAt: row.createdAt,
  });
});

router.delete("/admin/admins/:adminId", async (req, res): Promise<void> => {
  const adminId = Number(req.params.adminId);
  if (!Number.isInteger(adminId) || adminId <= 0) {
    res.status(404).json({ message: "Admin not found" });
    return;
  }
  const caller = (req as typeof req & { admin?: { adminUserId: number } })
    .admin;
  const [target] = await db
    .select()
    .from(adminUsersTable)
    .where(eq(adminUsersTable.id, adminId));
  if (!target) {
    res.status(404).json({ message: "Admin not found" });
    return;
  }
  if (target.id === caller?.adminUserId) {
    res.status(400).json({ message: "You cannot remove yourself" });
    return;
  }
  if (target.externalId != null) {
    const [claimedCount] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(adminUsersTable)
      .where(isNotNull(adminUsersTable.externalId));
    if ((claimedCount?.count ?? 0) <= 1) {
      res.status(400).json({ message: "The last admin cannot be removed" });
      return;
    }
  }
  // Removing an admin also revokes their sessions via ON DELETE CASCADE.
  await db.delete(adminUsersTable).where(eq(adminUsersTable.id, adminId));
  req.log.info(
    { adminId, pending: target.externalId == null },
    "Admin removed",
  );
  res.status(200).json({ message: "Removed" });
});

// ---------- Data browser ----------

const BROWSABLE_TABLES = [
  "industries",
  "brands",
  "engines",
  "survey_runs",
  "survey_responses",
  "users",
  "sessions",
  "ad_hoc_requests",
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
          queryType: surveyResponsesTable.queryType,
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
        "queryType",
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
    case "users": {
      const where = search
        ? or(
            ilike(usersTable.email, `%${search}%`),
            ilike(usersTable.firstName, `%${search}%`),
            ilike(usersTable.lastName, `%${search}%`),
          )
        : undefined;
      const [countRow] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(usersTable)
        .where(where);
      total = countRow?.count ?? 0;
      const data = await db
        .select()
        .from(usersTable)
        .where(where)
        .orderBy(desc(usersTable.createdAt))
        .limit(pageSize)
        .offset(offset);
      columns = ["id", "email", "firstName", "lastName", "createdAt", "disabledAt"];
      rows = data.map((r) => ({
        id: r.id,
        email: r.email,
        firstName: r.firstName,
        lastName: r.lastName,
        createdAt: r.createdAt.toISOString(),
        disabledAt: r.disabledAt ? r.disabledAt.toISOString() : null,
      }));
      break;
    }
    case "sessions": {
      // Session tokens are credentials — never expose them here.
      const where = search
        ? ilike(usersTable.email, `%${search}%`)
        : undefined;
      const [countRow] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(sessionsTable)
        .leftJoin(usersTable, eq(sessionsTable.userId, usersTable.id))
        .where(where);
      total = countRow?.count ?? 0;
      const data = await db
        .select({
          id: sessionsTable.id,
          userId: sessionsTable.userId,
          userEmail: usersTable.email,
          createdAt: sessionsTable.createdAt,
          expiresAt: sessionsTable.expiresAt,
        })
        .from(sessionsTable)
        .leftJoin(usersTable, eq(sessionsTable.userId, usersTable.id))
        .where(where)
        .orderBy(desc(sessionsTable.createdAt))
        .limit(pageSize)
        .offset(offset);
      columns = ["id", "userId", "userEmail", "createdAt", "expiresAt"];
      rows = data.map((r) => ({
        ...r,
        createdAt: r.createdAt.toISOString(),
        expiresAt: r.expiresAt.toISOString(),
      }));
      break;
    }
    case "ad_hoc_requests": {
      const conditions: SQL[] = [];
      if (search) conditions.push(ilike(adHocRequestsTable.brand, `%${search}%`));
      if (status) conditions.push(eq(adHocRequestsTable.status, status));
      const where = conditions.length ? and(...conditions) : undefined;
      const [countRow] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(adHocRequestsTable)
        .where(where);
      total = countRow?.count ?? 0;
      const data = await db
        .select({
          id: adHocRequestsTable.id,
          userId: adHocRequestsTable.userId,
          userEmail: usersTable.email,
          brand: adHocRequestsTable.brand,
          competitors: adHocRequestsTable.competitors,
          country: adHocRequestsTable.country,
          status: adHocRequestsTable.status,
          error: adHocRequestsTable.error,
          createdAt: adHocRequestsTable.createdAt,
          completedAt: adHocRequestsTable.completedAt,
        })
        .from(adHocRequestsTable)
        .leftJoin(usersTable, eq(adHocRequestsTable.userId, usersTable.id))
        .where(where)
        .orderBy(desc(adHocRequestsTable.createdAt))
        .limit(pageSize)
        .offset(offset);
      columns = [
        "id",
        "userId",
        "userEmail",
        "brand",
        "competitors",
        "country",
        "status",
        "error",
        "createdAt",
        "completedAt",
      ];
      rows = data.map((r) => ({
        ...r,
        createdAt: r.createdAt.toISOString(),
        completedAt: r.completedAt ? r.completedAt.toISOString() : null,
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
