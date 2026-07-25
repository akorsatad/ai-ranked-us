import app from "./app";
import { logger } from "./lib/logger";
import { ensureSeeded } from "./lib/seed";
import { startScheduler } from "./lib/scheduler";
import {
  failInterruptedRuns,
  recoverPendingAutoRuns,
  reconcileStaleRuns,
} from "./lib/survey";
import { backfillSeries } from "./lib/series";

/** How often the long-lived server sweeps for dead runs to finalize. */
const WATCHDOG_INTERVAL_MS = 60_000;

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");

  ensureSeeded()
    .then(() => failInterruptedRuns())
    .then(() => backfillSeries())
    .then(() => {
      startScheduler();
      // Periodic watchdog: finalize any run whose heartbeat has gone stale, so
      // a wedged run can never sit in "running" indefinitely.
      const watchdog = setInterval(() => {
        reconcileStaleRuns().catch((err) =>
          logger.error({ err }, "Stale-run watchdog failed"),
        );
      }, WATCHDOG_INTERVAL_MS);
      watchdog.unref();
      return recoverPendingAutoRuns();
    })
    .catch((startupErr) => {
      logger.error({ err: startupErr }, "Startup tasks failed");
    });
});
