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
});

export const brandsTable = pgTable("brands", {
  id: serial("id").primaryKey(),
  industryId: integer("industry_id")
    .notNull()
    .references(() => industriesTable.id),
  name: text("name").notNull(),
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

export const insertIndustrySchema = createInsertSchema(industriesTable).omit({
  id: true,
});
export type InsertIndustry = z.infer<typeof insertIndustrySchema>;
export type IndustryRow = typeof industriesTable.$inferSelect;
export type BrandRow = typeof brandsTable.$inferSelect;
export type EngineRow = typeof enginesTable.$inferSelect;
export type SurveyRunRow = typeof surveyRunsTable.$inferSelect;
export type SurveyResponseRow = typeof surveyResponsesTable.$inferSelect;
