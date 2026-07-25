import type { NextFunction, Request, Response } from "express";
import crypto from "node:crypto";
import {
  db,
  adminUsersTable,
  adminSessionsTable,
  type AdminUserRow,
} from "@workspace/db";
import { and, eq, gt, isNull, sql } from "drizzle-orm";
import { isGoogleAuthConfigured } from "../lib/authConfig";

export const ADMIN_SESSION_COOKIE = "airank_admin";
const ADMIN_SESSION_DAYS = 7;

/**
 * Emails granted admin automatically on first sign-in, from the
 * ADMIN_ALLOWED_EMAILS env var (comma-separated, case-insensitive).
 * When set, it also disables the open first-user bootstrap: only
 * allowlisted emails can become the initial admin.
 */
function allowedAdminEmails(): string[] {
  return (process.env.ADMIN_ALLOWED_EMAILS ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

export interface AdminIdentity {
  adminUserId: number;
  email: string | null;
}

/** Returns the authenticated admin for this request's session cookie, or null. */
export async function resolveAdminSession(
  req: Request,
): Promise<AdminIdentity | null> {
  const token = (req.cookies as Record<string, string> | undefined)?.[
    ADMIN_SESSION_COOKIE
  ];
  if (!token) return null;
  const now = new Date();
  const [row] = await db
    .select({
      adminUserId: adminUsersTable.id,
      email: adminUsersTable.email,
    })
    .from(adminSessionsTable)
    .innerJoin(
      adminUsersTable,
      eq(adminSessionsTable.adminUserId, adminUsersTable.id),
    )
    .where(
      and(
        eq(adminSessionsTable.token, token),
        gt(adminSessionsTable.expiresAt, now),
      ),
    )
    .limit(1);
  return row ?? null;
}

/**
 * Resolves whether a Google identity (verified email + stable subject id)
 * is an admin, creating/claiming rows as appropriate.
 * Order: existing admin row → pending email invite (row with null
 * externalId whose email matches) → ADMIN_ALLOWED_EMAILS allowlist →
 * bootstrap rule: if no admin rows exist at all AND no allowlist is
 * configured, the first authenticated user claims admin access.
 */
export async function ensureAdminForIdentity(
  externalId: string,
  email: string | null,
): Promise<AdminUserRow | null> {
  const [existing] = await db
    .select()
    .from(adminUsersTable)
    .where(eq(adminUsersTable.externalId, externalId));
  if (existing) return existing;

  // Claim a pending invite matching this verified email.
  if (email) {
    const claimed = await db
      .update(adminUsersTable)
      .set({ externalId, email })
      .where(
        and(
          isNull(adminUsersTable.externalId),
          sql`lower(${adminUsersTable.email}) = ${email.toLowerCase()}`,
        ),
      )
      .returning();
    if (claimed[0]) return claimed[0];
  }

  const allowlist = allowedAdminEmails();

  // Env allowlist grants admin regardless of bootstrap state.
  if (email && allowlist.includes(email.toLowerCase())) {
    const [granted] = await db
      .insert(adminUsersTable)
      .values({ externalId, email })
      .onConflictDoNothing()
      .returning();
    if (granted) return granted;
    const [me] = await db
      .select()
      .from(adminUsersTable)
      .where(eq(adminUsersTable.externalId, externalId));
    return me ?? null;
  }

  const [anyAdmin] = await db.select().from(adminUsersTable).limit(1);
  if (anyAdmin) return null;

  // With an allowlist configured, only allowlisted emails may bootstrap.
  if (allowlist.length > 0) return null;

  // No admin yet — claim it for this identity.
  const [row] = await db
    .insert(adminUsersTable)
    .values({ externalId, email })
    .onConflictDoNothing()
    .returning();
  if (row) return row;
  // Concurrent claim — re-check whether we won.
  const [me] = await db
    .select()
    .from(adminUsersTable)
    .where(eq(adminUsersTable.externalId, externalId));
  return me ?? null;
}

/** Creates a DB-backed admin session and returns the cookie token + expiry. */
export async function createAdminSession(
  adminUserId: number,
): Promise<{ token: string; expiresAt: Date }> {
  const token = crypto.randomBytes(32).toString("hex");
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + ADMIN_SESSION_DAYS);
  await db
    .insert(adminSessionsTable)
    .values({ adminUserId, token, expiresAt });
  return { token, expiresAt };
}

export async function deleteAdminSession(token: string): Promise<void> {
  await db
    .delete(adminSessionsTable)
    .where(eq(adminSessionsTable.token, token));
}

export async function requireAdmin(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
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
  (req as Request & { admin: AdminIdentity }).admin = identity;
  next();
}
