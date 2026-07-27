import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, usersTable } from "@workspace/db";
import { resolveSession } from "./auth";
import {
  stripeConfigured,
  createCheckoutSession,
  createPortalSession,
  handleWebhook,
} from "../lib/stripe";

const router: IRouter = Router();

/** Public: whether billing is live + the publishable key for the client. */
router.get("/stripe/config", (_req, res): void => {
  res.status(200).json({
    configured: stripeConfigured(),
    publishableKey: process.env.STRIPE_PUBLISHABLE_KEY ?? null,
  });
});

function originOf(req: import("express").Request): string {
  return (
    process.env.APP_BASE_URL ||
    `${req.protocol}://${req.get("host") ?? "localhost"}`
  );
}

async function currentUser(req: import("express").Request) {
  const session = await resolveSession(req);
  if (!session) return null;
  const [user] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.id, session.id));
  return user ?? null;
}

router.post("/stripe/checkout", async (req, res): Promise<void> => {
  if (!stripeConfigured()) {
    res.status(503).json({ message: "Billing is not configured" });
    return;
  }
  const user = await currentUser(req);
  if (!user) {
    res.status(401).json({ message: "Sign in to subscribe" });
    return;
  }
  const tierKey = String((req.body as { tier?: unknown })?.tier ?? "").trim();
  if (!tierKey) {
    res.status(400).json({ message: "tier is required" });
    return;
  }
  try {
    const result = await createCheckoutSession(user, tierKey, originOf(req));
    if ("error" in result) {
      res.status(400).json({ message: result.error });
      return;
    }
    res.status(200).json({ url: result.url });
  } catch (err) {
    req.log.error({ err }, "Stripe checkout failed");
    res.status(500).json({ message: "Could not start checkout" });
  }
});

router.post("/stripe/portal", async (req, res): Promise<void> => {
  if (!stripeConfigured()) {
    res.status(503).json({ message: "Billing is not configured" });
    return;
  }
  const user = await currentUser(req);
  if (!user) {
    res.status(401).json({ message: "Sign in first" });
    return;
  }
  try {
    const result = await createPortalSession(user, originOf(req));
    if ("error" in result) {
      res.status(400).json({ message: result.error });
      return;
    }
    res.status(200).json({ url: result.url });
  } catch (err) {
    req.log.error({ err }, "Stripe portal failed");
    res.status(500).json({ message: "Could not open billing portal" });
  }
});

// Stripe webhook — raw body (mounted via express.raw in app.ts), signature-verified.
router.post("/stripe/webhook", async (req, res): Promise<void> => {
  const signature = req.headers["stripe-signature"];
  if (typeof signature !== "string") {
    res.status(400).json({ message: "Missing signature" });
    return;
  }
  try {
    const type = await handleWebhook(req.body as Buffer, signature);
    req.log.info({ type }, "Stripe webhook handled");
    res.status(200).json({ received: true });
  } catch (err) {
    req.log.warn({ err }, "Stripe webhook rejected");
    res.status(400).json({ message: "Webhook error" });
  }
});

export default router;
