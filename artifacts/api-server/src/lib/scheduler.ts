import { gte } from "drizzle-orm";
import { db, surveyRunsTable } from "@workspace/db";
import { startSurveyRun, isRunInProgress } from "./survey";
import { logger } from "./logger";

const RUN_HOUR_UTC = 6; // daily run at 06:00 UTC
const CHECK_INTERVAL_MS = 10 * 60 * 1000;

async function maybeRunDailySurvey(): Promise<void> {
  const now = new Date();
  if (now.getUTCHours() < RUN_HOUR_UTC) return;
  if (isRunInProgress()) return;

  const startOfDay = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
  const todaysRuns = await db
    .select({ id: surveyRunsTable.id })
    .from(surveyRunsTable)
    .where(gte(surveyRunsTable.startedAt, startOfDay));
  if (todaysRuns.length > 0) return;

  logger.info("Starting scheduled daily survey run");
  await startSurveyRun("scheduled");
}

export function startScheduler(): void {
  setInterval(() => {
    maybeRunDailySurvey().catch((err) => {
      logger.error({ err }, "Scheduled survey check failed");
    });
  }, CHECK_INTERVAL_MS);
  // Also check shortly after boot so a missed day catches up.
  setTimeout(() => {
    maybeRunDailySurvey().catch((err) => {
      logger.error({ err }, "Boot survey check failed");
    });
  }, 30 * 1000);
  logger.info("Daily survey scheduler started");
}
