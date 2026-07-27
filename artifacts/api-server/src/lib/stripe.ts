import Stripe from "stripe";
import { eq } from "drizzle-orm";
import {
  db,
  usersTable,
  pricingTiersTable,
  type UserRow,
} from "@workspace/db";
import { logger } from "./logger";

export function stripeConfigured(): boolean {
  return !!process.env.STRIPE_SECRET_KEY;
}

let client: Stripe | null = null;
function stripe(): Stripe {
  if (!process.env.STRIPE_SECRET_KEY) {
    throw new Error("STRIPE_SECRET_KEY is not configured");
  }
  if (!client) client = new Stripe(process.env.STRIPE_SECRET_KEY);
  return client;
}

/**
 * Ensure every paid tier (monthlyPriceUsd set) has a Stripe recurring Price,
 * creating the Product + Price from the tier's own fields when missing. Stores
 * the price id back on the tier. Idempotent.
 */
export async function ensureTierPrices(): Promise<void> {
  if (!stripeConfigured()) return;
  const tiers = await db.select().from(pricingTiersTable);
  for (const tier of tiers) {
    if (tier.monthlyPriceUsd == null || tier.monthlyPriceUsd <= 0) continue;
    if (tier.stripePriceId) {
      // Verify the stored price still resolves with the current key. A price
      // created in test mode is invalid under a live key (and vice versa), so
      // recreate it instead of trusting a stale id.
      try {
        const existing = await stripe().prices.retrieve(tier.stripePriceId);
        if (existing && existing.active !== false) continue;
      } catch {
        logger.warn(
          { tier: tier.key, priceId: tier.stripePriceId },
          "Stored Stripe price no longer resolves; recreating",
        );
      }
    }
    const product = await stripe().products.create({
      name: `AI Ranked US — ${tier.name}`,
      metadata: { tierKey: tier.key },
    });
    const price = await stripe().prices.create({
      product: product.id,
      currency: "usd",
      unit_amount: Math.round(tier.monthlyPriceUsd * 100),
      recurring: { interval: "month" },
      metadata: { tierKey: tier.key },
    });
    await db
      .update(pricingTiersTable)
      .set({ stripePriceId: price.id })
      .where(eq(pricingTiersTable.id, tier.id));
    logger.info({ tier: tier.key, priceId: price.id }, "Created Stripe price for tier");
  }
}

async function getOrCreateCustomer(user: UserRow): Promise<string> {
  if (user.stripeCustomerId) {
    // A customer created under a different key/mode won't resolve; fall through
    // and recreate rather than pass a stale id to Checkout.
    try {
      const existing = await stripe().customers.retrieve(user.stripeCustomerId);
      if (existing && !(existing as { deleted?: boolean }).deleted) {
        return user.stripeCustomerId;
      }
    } catch {
      // stale customer id — recreate below
    }
  }
  const customer = await stripe().customers.create({
    email: user.email,
    name: `${user.firstName} ${user.lastName}`.trim() || undefined,
    metadata: { userId: String(user.id) },
  });
  await db
    .update(usersTable)
    .set({ stripeCustomerId: customer.id })
    .where(eq(usersTable.id, user.id));
  return customer.id;
}

/** Create a subscription Checkout session for a tier; returns the redirect URL. */
export async function createCheckoutSession(
  user: UserRow,
  tierKey: string,
  origin: string,
): Promise<{ url: string } | { error: string }> {
  await ensureTierPrices();
  const [tier] = await db
    .select()
    .from(pricingTiersTable)
    .where(eq(pricingTiersTable.key, tierKey));
  if (!tier) return { error: "Unknown tier" };
  if (!tier.stripePriceId) return { error: "This tier isn't purchasable online" };

  const customerId = await getOrCreateCustomer(user);
  const session = await stripe().checkout.sessions.create({
    mode: "subscription",
    customer: customerId,
    line_items: [{ price: tier.stripePriceId, quantity: 1 }],
    success_url: `${origin}/account?checkout=success`,
    cancel_url: `${origin}/#pricing`,
    metadata: { userId: String(user.id), tierKey },
    subscription_data: { metadata: { userId: String(user.id), tierKey } },
    allow_promotion_codes: true,
  });
  return session.url ? { url: session.url } : { error: "Could not start checkout" };
}

/** Customer portal for managing/cancelling the subscription. */
export async function createPortalSession(
  user: UserRow,
  origin: string,
): Promise<{ url: string } | { error: string }> {
  if (!user.stripeCustomerId) return { error: "No billing account yet" };
  const session = await stripe().billingPortal.sessions.create({
    customer: user.stripeCustomerId,
    return_url: `${origin}/account`,
  });
  return { url: session.url };
}

function statusIsActive(status: string): boolean {
  return status === "active" || status === "trialing";
}

/** Apply a subscription's current state to the owning user. */
async function applySubscription(sub: Stripe.Subscription): Promise<void> {
  const customerId =
    typeof sub.customer === "string" ? sub.customer : sub.customer.id;
  const [user] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.stripeCustomerId, customerId));
  if (!user) {
    logger.warn({ customerId }, "Stripe webhook: no user for customer");
    return;
  }
  const priceId = sub.items.data[0]?.price?.id ?? null;
  const [tier] = priceId
    ? await db
        .select()
        .from(pricingTiersTable)
        .where(eq(pricingTiersTable.stripePriceId, priceId))
    : [];
  const active = statusIsActive(sub.status);
  const tierKey = active && tier ? tier.key : "free";

  // Grant the tier's included tokens when a subscription becomes active and the
  // user isn't already on that tier (avoids re-granting on every webhook).
  const grantTokens =
    active && tier && user.tier !== tier.key ? tier.includedTokens : 0;

  await db
    .update(usersTable)
    .set({
      tier: tierKey,
      subscriptionStatus: sub.status,
      stripeSubscriptionId: sub.id,
      tokenBalance: grantTokens > 0 ? user.tokenBalance + grantTokens : user.tokenBalance,
    })
    .where(eq(usersTable.id, user.id));
  logger.info(
    { userId: user.id, tier: tierKey, status: sub.status, grantTokens },
    "Applied Stripe subscription to user",
  );
}

/**
 * Verify + process a Stripe webhook. Requires STRIPE_WEBHOOK_SECRET and the raw
 * request body. Returns the event type handled (or throws on signature failure).
 */
export async function handleWebhook(
  rawBody: Buffer | string,
  signature: string,
): Promise<string> {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) throw new Error("STRIPE_WEBHOOK_SECRET is not configured");
  const event = stripe().webhooks.constructEvent(rawBody, signature, secret);

  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object as Stripe.Checkout.Session;
      if (session.subscription) {
        const subId =
          typeof session.subscription === "string"
            ? session.subscription
            : session.subscription.id;
        const sub = await stripe().subscriptions.retrieve(subId);
        await applySubscription(sub);
      }
      break;
    }
    case "customer.subscription.created":
    case "customer.subscription.updated":
    case "customer.subscription.deleted": {
      await applySubscription(event.data.object as Stripe.Subscription);
      break;
    }
    default:
      break;
  }
  return event.type;
}
