import { Router, type IRouter } from "express";
import { eq, desc, and, gte } from "drizzle-orm";
import { db, adHocRequestsTable } from "@workspace/db";
import { resolveSession } from "./auth";
import { runAdHocSurvey, suggestCompetitors } from "../lib/adHocSurvey";
import {
  sanitizeBrandName,
  sanitizeCompetitors,
  sanitizeCountry,
} from "../lib/sanitizeInput";
import { logger } from "../lib/logger";

// Legacy cookie name still used to scope ownership of any pre-existing
// anonymous ad-hoc requests on the GET route.
const VISITOR_COOKIE = "airank_visitor";
const AUTH_DAILY_LIMIT = 1; // authenticated users: queries per rolling 24h

function serializeRequest(row: typeof adHocRequestsTable.$inferSelect) {
  return {
    id: row.id,
    brand: row.brand,
    competitors: row.competitors,
    country: row.country,
    status: row.status,
    error: row.error ?? null,
    results: row.results ?? null,
    createdAt: row.createdAt.toISOString(),
    completedAt: row.completedAt ? row.completedAt.toISOString() : null,
  };
}

const router: IRouter = Router();

// POST /rank/suggest-competitors
router.post("/rank/suggest-competitors", async (req, res): Promise<void> => {
  const body = req.body as { brand?: unknown; country?: unknown };
  // Strict allowlist sanitization — free text here flows into LLM prompts.
  const brand = sanitizeBrandName(body.brand);
  const country = sanitizeCountry(body.country);
  if (!brand) {
    res.status(400).json({ message: "brand is required" });
    return;
  }
  try {
    const competitors = (await suggestCompetitors(brand, country))
      .map((c) => sanitizeBrandName(c))
      .filter(Boolean);
    res.json({ competitors });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    req.log.warn({ err }, "Competitor suggestion failed");
    res.status(503).json({ message: `Could not suggest competitors: ${msg}` });
  }
});

// POST /rank/run
router.post("/rank/run", async (req, res): Promise<void> => {
  const body = req.body as {
    brand?: unknown;
    competitors?: unknown;
    country?: unknown;
  };

  // Strict allowlist sanitization + hard caps — these strings flow into
  // LLM prompts and stored records, so no code/SQL-ish characters survive.
  const brand = sanitizeBrandName(body.brand);
  const country = sanitizeCountry(body.country);
  const competitors = sanitizeCompetitors(body.competitors, brand);

  if (!brand) {
    res.status(400).json({ message: "brand is required" });
    return;
  }
  if (competitors.length === 0) {
    res.status(400).json({ message: "At least one competitor is required" });
    return;
  }

  // Rankings require a verified account — no anonymous runs. The client
  // gates on this 401 to open the account-setup flow, then re-runs the
  // stored query once the magic link is confirmed.
  const user = await resolveSession(req);
  if (!user) {
    res.status(401).json({
      message: "Create your account to run a ranking.",
      requiresAuth: true,
    });
    return;
  }

  // Per-account daily limit.
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const recentRows = await db
    .select()
    .from(adHocRequestsTable)
    .where(
      and(
        eq(adHocRequestsTable.userId, user.id),
        gte(adHocRequestsTable.createdAt, since),
      ),
    )
    .limit(AUTH_DAILY_LIMIT);
  if (recentRows.length >= AUTH_DAILY_LIMIT) {
    const oldest = recentRows.sort(
      (a, b) => a.createdAt.getTime() - b.createdAt.getTime(),
    )[0]!;
    const retryAt = new Date(oldest.createdAt.getTime() + 24 * 60 * 60 * 1000);
    res.status(429).json({
      message: `You've used your free ranking for today.`,
      retryAt: retryAt.toISOString(),
    });
    return;
  }

  // Create the request record
  const [requestRow] = await db
    .insert(adHocRequestsTable)
    .values({
      userId: user.id,
      visitorId: null,
      brand,
      competitors,
      country,
      status: "pending",
    })
    .returning();

  if (!requestRow) {
    res.status(500).json({ message: "Failed to create ranking request" });
    return;
  }

  req.log.info({ requestId: requestRow.id, brand }, "Ad-hoc rank started");

  // Fire-and-forget background survey
  void runAdHocSurvey(requestRow.id, brand, competitors, country).catch((err) => {
    logger.error({ requestId: requestRow.id, err }, "Ad-hoc survey crashed");
  });

  res.status(202).json(serializeRequest(requestRow));
});

// GET /rank/requests/:requestId
router.get("/rank/requests/:requestId", async (req, res): Promise<void> => {
  const id = parseInt(req.params.requestId ?? "", 10);
  if (isNaN(id)) {
    res.status(400).json({ message: "Invalid request ID" });
    return;
  }

  const rows = await db
    .select()
    .from(adHocRequestsTable)
    .where(eq(adHocRequestsTable.id, id))
    .limit(1);

  const row = rows[0];
  if (!row) {
    res.status(404).json({ message: "Request not found" });
    return;
  }

  // Ownership check: authenticated users must own the request; anonymous
  // visitors must hold the matching visitor cookie.
  const user = await resolveSession(req);
  const visitorId = (req.cookies as Record<string, string>)?.[VISITOR_COOKIE];

  if (row.userId !== null) {
    // Request belongs to an authenticated user — require matching session
    if (!user || user.id !== row.userId) {
      res.status(404).json({ message: "Request not found" });
      return;
    }
  } else {
    // Anonymous request — require matching visitor cookie
    if (!visitorId || visitorId !== row.visitorId) {
      res.status(404).json({ message: "Request not found" });
      return;
    }
  }

  res.json(serializeRequest(row));
});

// GET /rank/history
router.get("/rank/history", async (req, res): Promise<void> => {
  const user = await resolveSession(req);
  if (!user) {
    res.status(401).json({ message: "Not authenticated" });
    return;
  }

  const rows = await db
    .select()
    .from(adHocRequestsTable)
    .where(eq(adHocRequestsTable.userId, user.id))
    .orderBy(desc(adHocRequestsTable.createdAt))
    .limit(20);

  res.json(rows.map(serializeRequest));
});

export default router;
