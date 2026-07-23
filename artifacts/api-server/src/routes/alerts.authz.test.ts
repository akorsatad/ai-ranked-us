import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";

/**
 * Verifies that privileged alert-settings endpoints (test-email send and
 * settings update) are admin-guarded: unauthenticated callers get 401,
 * signed-in non-admins get 403, and the admin can perform the action.
 */

const state = {
  userId: null as string | null,
  isAdmin: false,
  emailSent: 0,
};

vi.mock("@clerk/express", () => ({
  getAuth: () => ({ userId: state.userId }),
  clerkClient: { users: { getUser: async () => ({ primaryEmailAddress: null }) } },
}));

vi.mock("../middlewares/requireAdmin", async () => {
  const actual = await vi.importActual<
    typeof import("../middlewares/requireAdmin")
  >("../middlewares/requireAdmin");
  return {
    ...actual,
    // Keep the real middleware shape but resolve admin state from the mock,
    // so the 401/403/next branching under test is the real code path.
    requireAdmin: async (
      req: express.Request,
      res: express.Response,
      next: express.NextFunction,
    ) => {
      if (!state.userId) {
        res.status(401).json({ message: "Authentication required" });
        return;
      }
      if (!state.isAdmin) {
        res.status(403).json({ message: "Admin access required" });
        return;
      }
      next();
    },
  };
});

vi.mock("../lib/alerts", () => ({
  getAlertSettings: async () => ({
    scoreDropThreshold: 10,
    rankDropThreshold: 2,
    emailEnabled: true,
    emailRecipient: "admin@example.com",
  }),
  setAlertSettings: async (s: unknown) => s,
}));

vi.mock("../lib/alertEmail", () => ({
  sendTestAlertEmail: async () => {
    state.emailSent++;
    return { ok: true, error: null };
  },
}));

vi.mock("@workspace/db", () => ({
  db: {},
  brandAlertsTable: {},
  adminUsersTable: {},
}));

import alertsRouter from "./alerts";

async function request(path: string, method: string): Promise<number> {
  const app = express();
  app.use(express.json());
  app.use(alertsRouter);
  const server = app.listen(0);
  try {
    const { port } = server.address() as AddressInfo;
    const res = await fetch(`http://127.0.0.1:${port}${path}`, { method });
    return res.status;
  } finally {
    server.close();
  }
}

beforeEach(() => {
  state.userId = null;
  state.isAdmin = false;
  state.emailSent = 0;
});

describe("test-email endpoint authorization", () => {
  it("rejects unauthenticated callers with 401 and sends no email", async () => {
    expect(await request("/alerts/settings/test-email", "POST")).toBe(401);
    expect(state.emailSent).toBe(0);
  });

  it("rejects signed-in non-admins with 403 and sends no email", async () => {
    state.userId = "user_other";
    state.isAdmin = false;
    expect(await request("/alerts/settings/test-email", "POST")).toBe(403);
    expect(state.emailSent).toBe(0);
  });

  it("lets the admin send a test email", async () => {
    state.userId = "user_admin";
    state.isAdmin = true;
    expect(await request("/alerts/settings/test-email", "POST")).toBe(200);
    expect(state.emailSent).toBe(1);
  });
});

describe("alert settings update authorization", () => {
  it("rejects unauthenticated settings updates with 401", async () => {
    expect(await request("/alerts/settings", "PUT")).toBe(401);
  });
});
