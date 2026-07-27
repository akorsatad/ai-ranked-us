import {
  pgTable,
  text,
  serial,
  integer,
  doublePrecision,
  timestamp,
  jsonb,
} from "drizzle-orm/pg-core";

// ── Users ─────────────────────────────────────────────────────────────────────

export const usersTable = pgTable("users", {
  id: serial("id").primaryKey(),
  email: text("email").notNull().unique(),
  firstName: text("first_name").notNull(),
  lastName: text("last_name").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  // Set when an admin disables the account; disabled users cannot sign in
  // or use an existing session.
  disabledAt: timestamp("disabled_at", { withTimezone: true }),
  // Live-beta gate: set by an admin to unlock paid plans / credits. Null means
  // the account is still in beta review (sign-in + the free ranking still work).
  activatedAt: timestamp("activated_at", { withTimezone: true }),
  // ── Billing (Stripe) ──
  tier: text("tier").notNull().default("free"), // free | <pricing_tiers.key>
  subscriptionStatus: text("subscription_status"), // active | trialing | past_due | canceled | null
  tokenBalance: integer("token_balance").notNull().default(0),
  stripeCustomerId: text("stripe_customer_id"),
  stripeSubscriptionId: text("stripe_subscription_id"),
});

export type UserRow = typeof usersTable.$inferSelect;

// ── Magic-link tokens ─────────────────────────────────────────────────────────

export const magicLinkTokensTable = pgTable("magic_link_tokens", {
  id: serial("id").primaryKey(),
  userId: integer("user_id")
    .notNull()
    .references(() => usersTable.id),
  token: text("token").notNull().unique(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  usedAt: timestamp("used_at", { withTimezone: true }),
});

export type MagicLinkTokenRow = typeof magicLinkTokensTable.$inferSelect;

// ── Sessions ──────────────────────────────────────────────────────────────────

export const sessionsTable = pgTable("sessions", {
  id: serial("id").primaryKey(),
  userId: integer("user_id")
    .notNull()
    .references(() => usersTable.id),
  token: text("token").notNull().unique(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
});

export type SessionRow = typeof sessionsTable.$inferSelect;

// ── Ad-hoc ranking requests ───────────────────────────────────────────────────

export interface AdHocRankingEntry {
  brandName: string;
  rank: number;
  score: number;
  rationale: string | null;
}

export interface AdHocMetricResult {
  metricKey: string;
  metricLabel: string;
  higherIsBetter: boolean;
  entries: AdHocRankingEntry[];
}

export interface AdHocEngineResult {
  engineKey: string;
  engineName: string;
  metrics: AdHocMetricResult[];
}

export interface AdHocResults {
  byEngine: AdHocEngineResult[];
  averaged: AdHocMetricResult[];
}

export const adHocRequestsTable = pgTable("ad_hoc_requests", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").references(() => usersTable.id),
  visitorId: text("visitor_id"),
  brand: text("brand").notNull(),
  competitors: jsonb("competitors").$type<string[]>().notNull(),
  country: text("country").notNull().default("US"),
  status: text("status").notNull().default("pending"), // pending | running | completed | failed
  results: jsonb("results").$type<AdHocResults>(),
  error: text("error"),
  // Token/cost usage for this custom query (null for older rows). Drives
  // per-run token charges and margin analysis.
  inputTokens: integer("input_tokens"),
  outputTokens: integer("output_tokens"),
  costUsd: doublePrecision("cost_usd"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
});

export type AdHocRequestRow = typeof adHocRequestsTable.$inferSelect;

// ── Visitor usage tracking (anonymous rate limiting) ──────────────────────────

export const visitorUsageTable = pgTable("visitor_usage", {
  visitorId: text("visitor_id").primaryKey(),
  queriesUsed: integer("queries_used").notNull().default(0),
  lastQueryAt: timestamp("last_query_at", { withTimezone: true }),
});

export type VisitorUsageRow = typeof visitorUsageTable.$inferSelect;
