import { eq } from "drizzle-orm";
import { db, appSettingsTable } from "@workspace/db";
import type { BrandRow } from "@workspace/db";
import type { MetricDef } from "./metrics";

export type PromptKind = "current" | "trend";
export const PROMPT_KINDS: PromptKind[] = ["current", "trend"];
export function isPromptKind(v: string): v is PromptKind {
  return v === "current" || v === "trend";
}

// Separate stored setting per prompt kind. The daily "current" ranking and
// the "trend" 13-week trajectory are asked in two fully isolated engine
// calls so neither answer anchors the other.
const SETTING_KEY: Record<PromptKind, string> = {
  current: "survey_prompt_template_current",
  trend: "survey_prompt_template_trend",
};

export interface PromptPlaceholderDef {
  name: string;
  description: string;
  required: boolean;
}

export const PROMPT_PLACEHOLDERS: PromptPlaceholderDef[] = [
  {
    name: "metric_label",
    description: "The metric's display name, e.g. Positive Sentiment",
    required: true,
  },
  {
    name: "metric_description",
    description: "One-sentence description of what the metric measures",
    required: true,
  },
  {
    name: "brand_count",
    description: "Number of brands being ranked",
    required: false,
  },
  {
    name: "brand_list",
    description: "Comma-separated list of brand names to rank",
    required: true,
  },
  {
    name: "scoring_direction",
    description:
      "Explains whether a higher score is better or worse for the brand",
    required: true,
  },
];

export const PROMPT_EXAMPLE_VALUES: Record<string, string> = {
  metric_label: "Positive Sentiment",
  metric_description:
    "How positively US consumers feel about the brand overall",
  brand_count: "4",
  brand_list: "Acme Airlines, Blue Sky Air, CloudJet, Delta Wings",
  scoring_direction: "higher score = better performance on this dimension",
};

// Daily snapshot: current-day ranking ONLY. The prompt explicitly tells the
// engine not to reason about history, so this answer isn't pegged to a trend.
export const DEFAULT_CURRENT_PROMPT_TEMPLATE = [
  `You are being surveyed, as of today, about how US consumers currently perceive major brands.`,
  ``,
  `Dimension surveyed: {{metric_label}} — {{metric_description}}.`,
  ``,
  `Rank these {{brand_count}} brands on this dimension for US consumers, based only on your best assessment of perception AS OF TODAY: {{brand_list}}.`,
  ``,
  `Judge only the present moment. Do NOT reason about historical trends or how perception has changed over time — give an independent current-day snapshot.`,
  ``,
  `Scoring: integer 0-100, {{scoring_direction}}. Rank 1 = highest score.`,
  ``,
  `Respond with STRICT JSON only, no markdown fences, exactly this shape:`,
  `{"rankings":[{"brand":"<name exactly as given>","rank":1,"score":87,"rationale":"<one short sentence>"}]}`,
].join("\n");

// 13-week trajectory ONLY. The prompt tells the engine to assess the trend
// independently, not to anchor it to any single current-day ranking.
export const DEFAULT_TREND_PROMPT_TEMPLATE = [
  `You are being surveyed about how US consumer perception of major brands has MOVED over the last 13 weeks.`,
  ``,
  `Dimension surveyed: {{metric_label}} — {{metric_description}}.`,
  ``,
  `For each of these {{brand_count}} brands, estimate a weekly trend line of the brand's score over the last 13 weeks (13 values, oldest week first, most recent week last): {{brand_list}}.`,
  ``,
  `Assess the trajectory independently, based only on how perception has been moving over that period. Do NOT anchor the series to any single current-day ranking — reason about the movement on its own.`,
  ``,
  `Scoring: integer 0-100, {{scoring_direction}}.`,
  ``,
  `Respond with STRICT JSON only, no markdown fences, exactly this shape:`,
  `{"trend":[{"brand":"<name exactly as given>","weekly_scores":[13 integers oldest first]}]}`,
].join("\n");

export const DEFAULT_TEMPLATES: Record<PromptKind, string> = {
  current: DEFAULT_CURRENT_PROMPT_TEMPLATE,
  trend: DEFAULT_TREND_PROMPT_TEMPLATE,
};

/** Returns names of required placeholders missing from the template. */
export function missingRequiredPlaceholders(template: string): string[] {
  return PROMPT_PLACEHOLDERS.filter(
    (p) => p.required && !template.includes(`{{${p.name}}}`),
  ).map((p) => p.name);
}

export function renderPromptTemplate(
  template: string,
  values: Record<string, string>,
): string {
  return template.replace(/\{\{(\w+)\}\}/g, (match, name: string) =>
    Object.prototype.hasOwnProperty.call(values, name)
      ? (values[name] ?? match)
      : match,
  );
}

export function placeholderValuesFor(
  metric: MetricDef,
  brands: BrandRow[],
): Record<string, string> {
  return {
    metric_label: metric.label,
    metric_description: metric.description,
    brand_count: String(brands.length),
    brand_list: brands.map((b) => b.name).join(", "),
    scoring_direction: metric.higherIsBetter
      ? "higher score = better performance on this dimension"
      : "higher score = MORE of this (i.e. worse for the brand)",
  };
}

/** The active template for a kind: the stored custom one, or the default. */
export async function getActivePromptTemplate(kind: PromptKind): Promise<{
  template: string;
  isCustom: boolean;
}> {
  const [row] = await db
    .select()
    .from(appSettingsTable)
    .where(eq(appSettingsTable.key, SETTING_KEY[kind]));
  if (row?.value) return { template: row.value, isCustom: true };
  return { template: DEFAULT_TEMPLATES[kind], isCustom: false };
}

export async function setStoredPromptTemplate(
  kind: PromptKind,
  template: string,
): Promise<void> {
  await db
    .insert(appSettingsTable)
    .values({
      key: SETTING_KEY[kind],
      value: template,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: appSettingsTable.key,
      set: { value: template, updatedAt: new Date() },
    });
}

export async function clearStoredPromptTemplate(kind: PromptKind): Promise<void> {
  await db
    .delete(appSettingsTable)
    .where(eq(appSettingsTable.key, SETTING_KEY[kind]));
}

export interface PromptTemplateKindInfo {
  kind: PromptKind;
  template: string;
  isCustom: boolean;
  defaultTemplate: string;
}

export async function promptTemplateInfo(): Promise<{
  templates: PromptTemplateKindInfo[];
  placeholders: PromptPlaceholderDef[];
  exampleValues: Record<string, string>;
}> {
  const templates: PromptTemplateKindInfo[] = [];
  for (const kind of PROMPT_KINDS) {
    const active = await getActivePromptTemplate(kind);
    templates.push({
      kind,
      template: active.template,
      isCustom: active.isCustom,
      defaultTemplate: DEFAULT_TEMPLATES[kind],
    });
  }
  return {
    templates,
    placeholders: PROMPT_PLACEHOLDERS,
    exampleValues: PROMPT_EXAMPLE_VALUES,
  };
}
