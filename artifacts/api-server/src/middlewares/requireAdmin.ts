import type { NextFunction, Request, Response } from "express";
import { getAuth, clerkClient } from "@clerk/express";
import { db, adminUsersTable } from "@workspace/db";
import { eq } from "drizzle-orm";

/**
 * Resolves whether the given Clerk user is the admin.
 * Bootstrap rule: if no admin exists yet, the first authenticated user
 * to hit an admin endpoint claims admin access.
 */
export async function ensureAdmin(
  clerkUserId: string,
): Promise<{ isAdmin: boolean; email: string | null }> {
  const [existing] = await db
    .select()
    .from(adminUsersTable)
    .where(eq(adminUsersTable.clerkUserId, clerkUserId));
  if (existing) return { isAdmin: true, email: existing.email };

  const [anyAdmin] = await db.select().from(adminUsersTable).limit(1);
  if (anyAdmin) return { isAdmin: false, email: null };

  // No admin yet — claim it for this user.
  let email: string | null = null;
  try {
    const user = await clerkClient.users.getUser(clerkUserId);
    email = user.primaryEmailAddress?.emailAddress ?? null;
  } catch {
    // Email lookup is best-effort; admin claim proceeds without it.
  }
  const [row] = await db
    .insert(adminUsersTable)
    .values({ clerkUserId, email })
    .onConflictDoNothing()
    .returning();
  if (!row) {
    // Concurrent claim — re-check whether we won.
    const [me] = await db
      .select()
      .from(adminUsersTable)
      .where(eq(adminUsersTable.clerkUserId, clerkUserId));
    return { isAdmin: !!me, email: me?.email ?? null };
  }
  return { isAdmin: true, email };
}

export async function requireAdmin(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const auth = getAuth(req);
  const userId = auth?.userId;
  if (!userId) {
    res.status(401).json({ message: "Authentication required" });
    return;
  }
  const { isAdmin } = await ensureAdmin(userId);
  if (!isAdmin) {
    res.status(403).json({ message: "Admin access required" });
    return;
  }
  next();
}
