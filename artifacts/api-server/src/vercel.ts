import type { Request, Response } from "express";
import app from "./app";
import { logger } from "./lib/logger";
import { ensureSeeded } from "./lib/seed";

/**
 * Serverless (Vercel) entrypoint. Unlike index.ts there is no app.listen,
 * no in-process scheduler (Vercel Cron hits /api/internal/cron/daily-survey
 * instead — see routes/cron.ts), and no startup run-recovery: marking
 * "running" runs as failed on every cold start would clobber runs being
 * processed by another warm instance. Catalog seeding is idempotent and
 * cheap once seeded, so it runs lazily once per instance.
 */

let seeding: Promise<void> | null = null;

function ensureBootstrapped(): Promise<void> {
  if (!seeding) {
    seeding = ensureSeeded().catch((err) => {
      logger.error({ err }, "Serverless bootstrap (seed) failed");
      seeding = null; // allow retry on the next request
      throw err;
    });
  }
  return seeding;
}

export default async function handler(
  req: Request,
  res: Response,
): Promise<void> {
  try {
    await ensureBootstrapped();
  } catch {
    // Seeding failure (e.g. schema not pushed yet) shouldn't take down
    // non-DB endpoints like /api/healthz; DB routes will surface their
    // own errors.
  }
  app(req, res);
}
