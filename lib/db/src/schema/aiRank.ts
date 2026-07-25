import {
  pgTable,
  text,
  serial,
  integer,
  timestamp,
  jsonb,
  boolean,
  uniqueIndex,
  doublePrecision,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const industriesTable = pgTable(
  "industries",
  {
    id: serial("id").primaryKey(),
    name: text("name").notNull(),
    slug: text("slug").notNull().unique(),
    country: text("country").notNull().default("US"),
    enabled: boolean("enabled").notNull().default(true),
  },
  (table) => [
    uniqueIndex("industries_lower_name_unique").on(sql`lower(${table.name})`),
  ],
);

export const brandsTable = pgTable(
  "brands",
  {
    id: serial("id").primaryKey(),
    industryId: integer("industry_id")
      .notNull()
      .references(() => industriesTable.id),
    name: text("name").notNull(),
    enabled: boolean("enabled").notNull().default(true),
  },
  (table) => [
    uniqueIndex("brands_industry_id_lower_name_unique").on(
      table.industryId,
      sql`lower(${table.name})`,
    ),
  ],
);

export const adminUsersTable = pgTable("admin_users", {
  id: serial("id").primaryKey(),
  // Identity at the auth provider, e.g. "google:<sub>". Null for pending
  // email invites: the row is claimed (externalId filled in) when someone
  // signs in with a matching verified email.
  externalId: text("external_id").unique(),
  email: text("email"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type AdminUserRow = typeof adminUsersTable.$inferSelect;

// Sessions for the admin console (separate from public magic-link sessions).
export const adminSessionsTable = pgTable("admin_sessions", {
  id: serial("id").primaryKey(),
  adminUserId: integer("admin_user_id")
    .notNull()
    .references(() => adminUsersTable.id, { onDelete: "cascade" }),
  token: text("token").notNull().unique(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
});

export type AdminSessionRow = typeof adminSessionsTable.$inferSelect;

// Commercial pricing tiers. Billing is token-based: each tier has its own
// cost-per-token rate that admins edit. Monthly price is the plan fee;
// Enterprise leaves it null (custom). `features` is a display bullet list.
export const pricingTiersTable = pgTable("pricing_tiers", {
  id: serial("id").primaryKey(),
  key: text("key").notNull().unique(), // starter | pro | enterprise
  name: text("name").notNull(),
  blurb: text("blurb").notNull().default(""),
  // Plan fee per month (USD). Null = custom / contact sales (Enterprise).
  monthlyPriceUsd: doublePrecision("monthly_price_usd"),
  // The billed rate per token for this tier. Admin-editable.
  costPerTokenUsd: doublePrecision("cost_per_token_usd").notNull().default(0),
  // Tokens included with the monthly fee before refills are needed.
  includedTokens: integer("included_tokens").notNull().default(0),
  features: jsonb("features").$type<string[]>().notNull().default([]),
  highlighted: boolean("highlighted").notNull().default(false),
  sortOrder: integer("sort_order").notNull().default(0),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export type PricingTierRow = typeof pricingTiersTable.$inferSelect;

export const providerApiKeysTable = pgTable("provider_api_keys", {
  id: serial("id").primaryKey(),
  provider: text("provider").notNull().unique(), // openai | anthropic | gemini | openrouter
  apiKey: text("api_key").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export type ProviderApiKeyRow = typeof providerApiKeysTable.$inferSelect;

export const enginesTable = pgTable("engines", {
  id: serial("id").primaryKey(),
  key: text("key").notNull().unique(),
  name: text("name").notNull(),
  vendor: text("vendor").notNull(),
  provider: text("provider").notNull(), // openai | anthropic | gemini | openrouter
  model: text("model").notNull(),
  enabled: boolean("enabled").notNull().default(true),
});

export const appSettingsTable = pgTable("app_settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/** Result of a failed pre-flight provider key check, stored on the run. */
export interface StoredKeyWarning {
  provider: string;
  source: "stored" | "env" | "none";
  error: string;
}

export const surveyRunsTable = pgTable("survey_runs", {
  id: serial("id").primaryKey(),
  status: text("status").notNull().default("running"), // running | pausing | paused | cancelling | cancelled | completed | failed | partial
  trigger: text("trigger").notNull().default("manual"), // scheduled | manual
  industryId: integer("industry_id").references(() => industriesTable.id), // null = full run, set = scoped to one industry
  engineId: integer("engine_id").references(() => enginesTable.id), // null = all engines, set = scoped to one AI engine
  startedAt: timestamp("started_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  // Liveness signal written periodically by the active run loop. A run whose
  // heartbeat has gone stale is treated as dead and finalized by the watchdog,
  // so a run can never sit in "running" forever. Null for historical rows.
  heartbeatAt: timestamp("heartbeat_at", { withTimezone: true }),
  error: text("error"),
  totalQueries: integer("total_queries").notNull().default(0),
  succeededQueries: integer("succeeded_queries").notNull().default(0),
  failedQueries: integer("failed_queries").notNull().default(0),
  // Non-null when the pre-flight provider key check found failing keys.
  keyWarnings: jsonb("key_warnings").$type<StoredKeyWarning[]>(),
  totalInputTokens: integer("total_input_tokens"),
  totalOutputTokens: integer("total_output_tokens"),
  totalCostUsd: doublePrecision("total_cost_usd"),
});

export interface StoredRankingEntry {
  brandId: number;
  brandName: string;
  rank: number;
  score: number;
  rationale: string | null;
}

export interface StoredTrendPoint {
  weekIndex: number;
  weekLabel: string;
  score: number;
}

export interface StoredBrandTrend {
  brandId: number;
  brandName: string;
  points: StoredTrendPoint[];
}

export const surveyResponsesTable = pgTable("survey_responses", {
  id: serial("id").primaryKey(),
  runId: integer("run_id")
    .notNull()
    .references(() => surveyRunsTable.id),
  engineId: integer("engine_id")
    .notNull()
    .references(() => enginesTable.id),
  industryId: integer("industry_id")
    .notNull()
    .references(() => industriesTable.id),
  metricKey: text("metric_key").notNull(),
  // Which isolated engine call this row is: "current" (today's ranking only),
  // "trend" (13-week trajectory only), or "combined" (legacy single call that
  // asked for both — all imported/historical rows are this).
  queryType: text("query_type").notNull().default("combined"),
  status: text("status").notNull().default("ok"), // ok | failed
  error: text("error"),
  prompt: text("prompt"), // exact rendered prompt sent to the engine
  rawResponse: text("raw_response"), // raw engine response text (also stored for parse failures)
  entries: jsonb("entries").$type<StoredRankingEntry[]>(),
  trend: jsonb("trend").$type<StoredBrandTrend[]>(),
  // Usage capture (null for historical responses that predate usage tracking)
  resolvedModel: text("resolved_model"),
  inputTokens: integer("input_tokens"),
  outputTokens: integer("output_tokens"),
  costUsd: doublePrecision("cost_usd"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/**
 * Structured per-day measured scores/ranks — one row per brand within a
 * successful survey response. Mirrors survey_responses.entries but queryable.
 */
export const dailyMeasurementsTable = pgTable(
  "daily_measurements",
  {
    id: serial("id").primaryKey(),
    responseId: integer("response_id")
      .notNull()
      .references(() => surveyResponsesTable.id),
    runId: integer("run_id")
      .notNull()
      .references(() => surveyRunsTable.id),
    engineId: integer("engine_id")
      .notNull()
      .references(() => enginesTable.id),
    industryId: integer("industry_id")
      .notNull()
      .references(() => industriesTable.id),
    metricKey: text("metric_key").notNull(),
    brandId: integer("brand_id")
      .notNull()
      .references(() => brandsTable.id),
    brandName: text("brand_name").notNull(),
    rank: integer("rank").notNull(),
    scoreX10: integer("score_x10").notNull(), // score * 10 to keep one decimal
    measuredAt: timestamp("measured_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    uniqueIndex("daily_measurements_response_brand_unique").on(
      table.responseId,
      table.brandId,
    ),
  ],
);

/**
 * Per-day snapshots of the AI-estimated 13-week trend — one row per
 * successful survey response, preserving every day's estimate of the past.
 */
export const trendSnapshotsTable = pgTable(
  "trend_snapshots",
  {
    id: serial("id").primaryKey(),
    responseId: integer("response_id")
      .notNull()
      .references(() => surveyResponsesTable.id),
    runId: integer("run_id")
      .notNull()
      .references(() => surveyRunsTable.id),
    engineId: integer("engine_id")
      .notNull()
      .references(() => enginesTable.id),
    industryId: integer("industry_id")
      .notNull()
      .references(() => industriesTable.id),
    metricKey: text("metric_key").notNull(),
    snapshotDate: text("snapshot_date").notNull(), // YYYY-MM-DD (UTC)
    trend: jsonb("trend").$type<StoredBrandTrend[]>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("trend_snapshots_response_unique").on(table.responseId),
  ],
);

export type DailyMeasurementRow = typeof dailyMeasurementsTable.$inferSelect;
export type TrendSnapshotRow = typeof trendSnapshotsTable.$inferSelect;

export const brandAlertsTable = pgTable("brand_alerts", {
  id: serial("id").primaryKey(),
  runId: integer("run_id")
    .notNull()
    .references(() => surveyRunsTable.id),
  // Null for run_issue alerts, which describe a whole run rather than a brand.
  brandId: integer("brand_id").references(() => brandsTable.id),
  brandName: text("brand_name").notNull(),
  industryId: integer("industry_id").references(() => industriesTable.id),
  industryName: text("industry_name").notNull(),
  metricKey: text("metric_key").notNull(),
  metricLabel: text("metric_label").notNull(),
  kind: text("kind").notNull(), // score_drop | rank_drop | run_issue
  previousValue: integer("previous_value").notNull(), // score x10 for score alerts, rank for rank alerts
  currentValue: integer("current_value").notNull(),
  delta: integer("delta").notNull(), // magnitude of the drop (score x10 or rank positions)
  threshold: integer("threshold").notNull(), // threshold in effect when triggered (score x10 or positions)
  read: boolean("read").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// Cron-engine schedules: recurring or one-time survey definitions the daily
// cron endpoint evaluates. Optional industry/engine scope, like runs.
export const surveySchedulesTable = pgTable("survey_schedules", {
  id: serial("id").primaryKey(),
  mode: text("mode").notNull().default("recurring"), // once | recurring
  cadence: text("cadence"), // daily | weekly | monthly (recurring only)
  industryId: integer("industry_id").references(() => industriesTable.id),
  engineId: integer("engine_id").references(() => enginesTable.id),
  enabled: boolean("enabled").notNull().default(true),
  // When this schedule should next fire. The cron endpoint triggers any
  // enabled schedule whose next_run_at is due, then advances or disables it.
  nextRunAt: timestamp("next_run_at", { withTimezone: true }).notNull(),
  lastRunAt: timestamp("last_run_at", { withTimezone: true }),
  lastRunId: integer("last_run_id"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export type SurveyScheduleRow = typeof surveySchedulesTable.$inferSelect;

export const insertIndustrySchema = createInsertSchema(industriesTable).omit({
  id: true,
});
export type InsertIndustry = z.infer<typeof insertIndustrySchema>;
export type IndustryRow = typeof industriesTable.$inferSelect;
export type BrandRow = typeof brandsTable.$inferSelect;
export type EngineRow = typeof enginesTable.$inferSelect;
export type SurveyRunRow = typeof surveyRunsTable.$inferSelect;
export type SurveyResponseRow = typeof surveyResponsesTable.$inferSelect;
export type BrandAlertRow = typeof brandAlertsTable.$inferSelect;
