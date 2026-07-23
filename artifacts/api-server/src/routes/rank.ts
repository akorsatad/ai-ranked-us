import { Router, type IRouter } from "express";
import { eq, desc, and, gte } from "drizzle-orm";
import {
  db,
  adHocRequestsTable,
  visitorUsageTable,
} from "@workspace/db";
import { resolveSession } from "./auth";
import { runAdHocSurvey, suggestCompetitors } from "../lib/adHocSurvey";
import { logger } from "../lib/logger";
import crypto from "node:crypto";

const VISITOR_COOKIE = "airank_visitor";
const VISITOR_FREE_QUERIES = 1; // anonymous visitors get this many free queries
const AUTH_DAILY_LIMIT = 1; // authenticated users: queries per rolling 24h

function getOrCreateVisitorId(
  req: import("express").Request,
  res: import("express").Response,
): string {
  const existing = (req.cookies as Record<string, string>)?.[VISITOR_COOKIE];
  if (existing) return existing;
  const id = crypto.randomUUID();
  res.cookie(VISITOR_COOKIE, id, {
    httpOnly: true,
    sameSite: "lax",
    maxAge: 365 * 24 * 60 * 60 * 1000,
    path: "/",
  });
  return id;
}

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
  const { brand, country = "US" } = req.body as { brand?: string; country?: string };
  if (!brand?.trim()) {
    res.status(400).json({ message: "brand is required" });
    return;
  }
  try {
    const competitors = await suggestCompetitors(brand.trim(), country);
    res.json({ competitors });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    req.log.warn({ err }, "Competitor suggestion failed");
    res.status(503).json({ message: `Could not suggest competitors: ${msg}` });
  }
});

// POST /rank/run
router.post("/rank/run", async (req, res): Promise<void> => {
  const { brand, competitors = [], country = "US" } = req.body as {
    brand?: string;
    competitors?: string[];
    country?: string;
  };

  if (!brand?.trim()) {
    res.status(400).json({ message: "brand is required" });
    return;
  }
  if (!Array.isArray(competitors) || competitors.length === 0) {
    res.status(400).json({ message: "At least one competitor is required" });
    return;
  }

  const user = await resolveSession(req);
  const visitorId = getOrCreateVisitorId(req, res);

  if (user) {
    // Authenticated: check daily limit
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
  } else {
    // Anonymous: check visitor usage
    const usage = await db
      .select()
      .from(visitorUsageTable)
      .where(eq(visitorUsageTable.visitorId, visitorId))
      .limit(1);

    const used = usage[0]?.queriesUsed ?? 0;
    if (used >= VISITOR_FREE_QUERIES) {
      res.status(401).json({
        message: "Sign in to run more custom rankings.",
        requiresAuth: true,
      });
      return;
    }

    // Increment usage
    if (usage.length === 0) {
      await db.insert(visitorUsageTable).values({
        visitorId,
        queriesUsed: 1,
        lastQueryAt: new Date(),
      });
    } else {
      await db
        .update(visitorUsageTable)
        .set({ queriesUsed: (usage[0]!.queriesUsed ?? 0) + 1, lastQueryAt: new Date() })
        .where(eq(visitorUsageTable.visitorId, visitorId));
    }
  }

  // Create the request record
  const [requestRow] = await db
    .insert(adHocRequestsTable)
    .values({
      userId: user?.id ?? null,
      visitorId: user ? null : visitorId,
      brand: brand.trim(),
      competitors: competitors.map((c) => String(c).trim()).filter(Boolean),
      country,
      status: "pending",
    })
    .returning();

  if (!requestRow) {
    res.status(500).json({ message: "Failed to create ranking request" });
    return;
  }

  req.log.info({ requestId: requestRow.id, brand: brand.trim() }, "Ad-hoc rank started");

  // Fire-and-forget background survey
  void runAdHocSurvey(requestRow.id, brand.trim(), competitors, country).catch((err) => {
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
