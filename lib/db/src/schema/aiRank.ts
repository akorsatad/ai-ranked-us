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
  clerkUserId: text("clerk_user_id").notNull().unique(),
  email: text("email"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type AdminUserRow = typeof adminUsersTable.$inferSelect;

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
  startedAt: timestamp("started_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
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
  brandId: integer("brand_id")
    .notNull()
    .references(() => brandsTable.id),
  brandName: text("brand_name").notNull(),
  industryId: integer("industry_id")
    .notNull()
    .references(() => industriesTable.id),
  industryName: text("industry_name").notNull(),
  metricKey: text("metric_key").notNull(),
  metricLabel: text("metric_label").notNull(),
  kind: text("kind").notNull(), // score_drop | rank_drop
  previousValue: integer("previous_value").notNull(), // score x10 for score alerts, rank for rank alerts
  currentValue: integer("current_value").notNull(),
  delta: integer("delta").notNull(), // magnitude of the drop (score x10 or rank positions)
  threshold: integer("threshold").notNull(), // threshold in effect when triggered (score x10 or positions)
  read: boolean("read").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

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
