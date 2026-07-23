import type { Request, Response, NextFunction } from "express";
import { resolveSession } from "../routes/auth";

/**
 * Express middleware that requires a valid authenticated session.
 * Returns 401 if the request is not authenticated.
 */
export async function requireSession(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const user = await resolveSession(req);
  if (!user) {
    res.status(401).json({ message: "Authentication required" });
    return;
  }
  // Attach user to request for downstream handlers
  (req as Request & { user: typeof user }).user = user;
  next();
}
