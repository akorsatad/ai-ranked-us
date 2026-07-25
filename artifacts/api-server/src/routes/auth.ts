import { Router, type IRouter } from "express";
import { eq, and, gt, isNull } from "drizzle-orm";
import {
  db,
  usersTable,
  magicLinkTokensTable,
  sessionsTable,
} from "@workspace/db";
import { sendMagicLinkEmail } from "../lib/mailer";
import { sanitizePersonName } from "../lib/sanitizeInput";
import { logger } from "../lib/logger";
import crypto from "node:crypto";

const SESSION_COOKIE = "airank_session";
const SESSION_DAYS = 30;
const TOKEN_MINUTES = 15;

function generateToken(): string {
  return crypto.randomBytes(32).toString("hex");
}

function sessionExpiry(): Date {
  const d = new Date();
  d.setDate(d.getDate() + SESSION_DAYS);
  return d;
}

function tokenExpiry(): Date {
  const d = new Date();
  d.setMinutes(d.getMinutes() + TOKEN_MINUTES);
  return d;
}

/** Returns the authenticated user row for this request, or null. */
export async function resolveSession(
  req: import("express").Request,
): Promise<{ id: number; email: string; firstName: string; lastName: string } | null> {
  const token = (req.cookies as Record<string, string>)?.[SESSION_COOKIE];
  if (!token) return null;

  const now = new Date();
  const rows = await db
    .select({
      id: usersTable.id,
      email: usersTable.email,
      firstName: usersTable.firstName,
      lastName: usersTable.lastName,
    })
    .from(sessionsTable)
    .innerJoin(usersTable, eq(sessionsTable.userId, usersTable.id))
    .where(
      and(
        eq(sessionsTable.token, token),
        gt(sessionsTable.expiresAt, now),
        isNull(usersTable.disabledAt),
      ),
    )
    .limit(1);

  return rows[0] ?? null;
}

/**
 * Returns a trusted base URL for magic-link generation.
 * Uses APP_BASE_URL env var (required in production) to avoid host-header injection.
 * Falls back to a localhost dev URL when not set.
 */
function trustedBaseUrl(): string {
  if (process.env.APP_BASE_URL) {
    return process.env.APP_BASE_URL.replace(/\/$/, "");
  }
  // Development-only fallback — never used if APP_BASE_URL is set in prod
  return "http://localhost:5173";
}

const router: IRouter = Router();

// POST /auth/request-link
router.post("/auth/request-link", async (req, res): Promise<void> => {
  const body = req.body as {
    email?: string;
    firstName?: unknown;
    lastName?: unknown;
  };
  const email = body.email;
  // Names are free text rendered in emails/UI — allowlist-sanitize + cap.
  const firstName = sanitizePersonName(body.firstName);
  const lastName = sanitizePersonName(body.lastName);

  if (!email || !firstName || !lastName) {
    res.status(400).json({ message: "email, firstName, and lastName are required" });
    return;
  }

  const normalizedEmail = email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
    res.status(400).json({ message: "Invalid email address" });
    return;
  }

  // Upsert user
  let user;
  const existing = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.email, normalizedEmail))
    .limit(1);

  if (existing[0]) {
    user = existing[0];
    if (user.disabledAt) {
      // Same response as success so a disabled account can't be probed.
      res.json({ message: "Check your inbox — your sign-in link is on its way." });
      return;
    }
  } else {
    const [created] = await db
      .insert(usersTable)
      .values({ email: normalizedEmail, firstName: firstName.trim(), lastName: lastName.trim() })
      .returning();
    user = created!;
  }

  // Create magic link token
  const token = generateToken();
  await db.insert(magicLinkTokensTable).values({
    userId: user.id,
    token,
    expiresAt: tokenExpiry(),
  });

  const link = `${trustedBaseUrl()}/auth/verify?token=${token}`;

  try {
    await sendMagicLinkEmail(normalizedEmail, firstName.trim(), link);
  } catch (err) {
    req.log.error({ err }, "Failed to send magic link email");
    res.status(500).json({ message: "Failed to send email. Please try again." });
    return;
  }

  req.log.info({ userId: user.id }, "Magic link requested");
  res.json({ message: "Check your inbox — your sign-in link is on its way." });
});

// POST /auth/verify
router.post("/auth/verify", async (req, res): Promise<void> => {
  const { token } = req.body as { token?: string };
  if (!token) {
    res.status(400).json({ message: "Token is required" });
    return;
  }

  const now = new Date();

  // Atomic: mark the token used in a single conditional UPDATE, preventing replay races.
  // The WHERE clause checks validity (not expired, not yet used) and the RETURNING
  // clause gives us the row only when the update actually applied.
  const consumed = await db
    .update(magicLinkTokensTable)
    .set({ usedAt: now })
    .where(
      and(
        eq(magicLinkTokensTable.token, token),
        gt(magicLinkTokensTable.expiresAt, now),
        isNull(magicLinkTokensTable.usedAt),
      ),
    )
    .returning();

  const tokenRow = consumed[0];
  if (!tokenRow) {
    res.status(400).json({ message: "This link is invalid or has expired. Please request a new one." });
    return;
  }

  // Fetch user (and refuse disabled accounts before minting a session)
  const users = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.id, tokenRow.userId))
    .limit(1);
  const user = users[0]!;
  if (user.disabledAt) {
    res.status(403).json({ message: "This account has been disabled." });
    return;
  }

  // Create session
  const sessionToken = generateToken();
  await db.insert(sessionsTable).values({
    userId: tokenRow.userId,
    token: sessionToken,
    expiresAt: sessionExpiry(),
  });

  res.cookie(SESSION_COOKIE, sessionToken, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    expires: sessionExpiry(),
    path: "/",
  });

  req.log.info({ userId: user.id }, "User signed in");
  res.json({ id: user.id, email: user.email, firstName: user.firstName, lastName: user.lastName });
});

// GET /auth/me
router.get("/auth/me", async (req, res): Promise<void> => {
  const user = await resolveSession(req);
  if (!user) {
    res.status(401).json({ message: "Not authenticated" });
    return;
  }
  res.json(user);
});

// DELETE /auth/session
router.delete("/auth/session", async (req, res): Promise<void> => {
  const token = (req.cookies as Record<string, string>)?.[SESSION_COOKIE];
  if (token) {
    await db.delete(sessionsTable).where(eq(sessionsTable.token, token));
  }
  res.clearCookie(SESSION_COOKIE, { path: "/" });
  res.json({ message: "Signed out" });
});

export default router;
