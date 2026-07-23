import app from "./app";
import { logger } from "./lib/logger";
import { ensureSeeded } from "./lib/seed";
import { startScheduler } from "./lib/scheduler";
import { failInterruptedRuns, recoverPendingAutoRuns } from "./lib/survey";

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
    .then(() => {
      startScheduler();
      return recoverPendingAutoRuns();
    })
    .catch((startupErr) => {
      logger.error({ err: startupErr }, "Startup tasks failed");
    });
});
