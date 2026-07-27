/**
 * Keep background work alive past the HTTP response.
 *
 * On Vercel a serverless function is frozen the moment it responds, which kills
 * any fire-and-forget promise still running (e.g. an ad-hoc survey started
 * after a 202). The platform exposes a `waitUntil` on its request context so
 * work can be registered to run to completion (up to the function's
 * maxDuration). We read that context directly via the well-known symbol so we
 * don't need the `@vercel/functions` package. Locally (a long-running
 * `app.listen` process) there is no such context and the promise simply
 * finishes on its own.
 */
const REQUEST_CONTEXT = Symbol.for("@vercel/request-context");

type VercelRequestContext = {
  get?: () => { waitUntil?: (p: Promise<unknown>) => void } | undefined;
};

export function keepAlive(promise: Promise<unknown>): void {
  // Never let a rejection become an unhandled promise rejection.
  const settled = promise.catch(() => undefined);
  try {
    const holder = (globalThis as Record<symbol, unknown>)[REQUEST_CONTEXT] as
      | VercelRequestContext
      | undefined;
    const waitUntil = holder?.get?.()?.waitUntil;
    if (typeof waitUntil === "function") {
      waitUntil(settled);
      return;
    }
  } catch {
    /* fall through to plain fire-and-forget */
  }
  // Long-running process (local/Replit): the event loop stays alive.
  void settled;
}
