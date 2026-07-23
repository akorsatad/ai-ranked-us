import { eq } from "drizzle-orm";
import { db, appSettingsTable } from "@workspace/db";
import type { BrandRow } from "@workspace/db";
import type { MetricDef } from "./metrics";

export const PROMPT_TEMPLATE_SETTING_KEY = "survey_prompt_template";

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

export const DEFAULT_PROMPT_TEMPLATE = [
  `You are being surveyed, as of today, about how US consumers perceive major brands.`,
  ``,
  `Dimension surveyed: {{metric_label}} — {{metric_description}}.`,
  ``,
  `Rank these {{brand_count}} brands on this dimension for US consumers: {{brand_list}}.`,
  ``,
  `Also estimate a weekly trend line of each brand's score over the last 13 weeks (13 values, oldest week first, most recent week last), based on your available knowledge of how perception has been moving.`,
  ``,
  `Scoring: integer 0-100, {{scoring_direction}}. Rank 1 = highest score.`,
  ``,
  `Respond with STRICT JSON only, no markdown fences, exactly this shape:`,
  `{"rankings":[{"brand":"<name exactly as given>","rank":1,"score":87,"rationale":"<one short sentence>"}],"trend":[{"brand":"<name exactly as given>","weekly_scores":[13 integers oldest first]}]}`,
].join("\n");

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

/** The active template: the stored custom one, or the built-in default. */
export async function getActivePromptTemplate(): Promise<{
  template: string;
  isCustom: boolean;
}> {
  const [row] = await db
    .select()
    .from(appSettingsTable)
    .where(eq(appSettingsTable.key, PROMPT_TEMPLATE_SETTING_KEY));
  if (row?.value) return { template: row.value, isCustom: true };
  return { template: DEFAULT_PROMPT_TEMPLATE, isCustom: false };
}

export async function setStoredPromptTemplate(template: string): Promise<void> {
  await db
    .insert(appSettingsTable)
    .values({
      key: PROMPT_TEMPLATE_SETTING_KEY,
      value: template,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: appSettingsTable.key,
      set: { value: template, updatedAt: new Date() },
    });
}

export async function clearStoredPromptTemplate(): Promise<void> {
  await db
    .delete(appSettingsTable)
    .where(eq(appSettingsTable.key, PROMPT_TEMPLATE_SETTING_KEY));
}

export async function promptTemplateInfo(): Promise<{
  template: string;
  isCustom: boolean;
  defaultTemplate: string;
  placeholders: PromptPlaceholderDef[];
  exampleValues: Record<string, string>;
}> {
  const active = await getActivePromptTemplate();
  return {
    ...active,
    defaultTemplate: DEFAULT_PROMPT_TEMPLATE,
    placeholders: PROMPT_PLACEHOLDERS,
    exampleValues: PROMPT_EXAMPLE_VALUES,
  };
}
