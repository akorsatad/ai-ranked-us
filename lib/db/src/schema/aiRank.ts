import {
  pgTable,
  text,
  serial,
  integer,
  timestamp,
  jsonb,
  boolean,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const industriesTable = pgTable("industries", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  country: text("country").notNull().default("US"),
  enabled: boolean("enabled").notNull().default(true),
});

export const brandsTable = pgTable("brands", {
  id: serial("id").primaryKey(),
  industryId: integer("industry_id")
    .notNull()
    .references(() => industriesTable.id),
  name: text("name").notNull(),
  enabled: boolean("enabled").notNull().default(true),
});

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

export const surveyRunsTable = pgTable("survey_runs", {
  id: serial("id").primaryKey(),
  status: text("status").notNull().default("running"), // running | completed | failed | partial
  trigger: text("trigger").notNull().default("manual"), // scheduled | manual
  startedAt: timestamp("started_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  error: text("error"),
  totalQueries: integer("total_queries").notNull().default(0),
  succeededQueries: integer("succeeded_queries").notNull().default(0),
  failedQueries: integer("failed_queries").notNull().default(0),
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
  entries: jsonb("entries").$type<StoredRankingEntry[]>(),
  trend: jsonb("trend").$type<StoredBrandTrend[]>(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

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
