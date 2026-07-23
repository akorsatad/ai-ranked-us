import { eq } from "drizzle-orm";
import { db, providerApiKeysTable, type ProviderApiKeyRow } from "@workspace/db";

export const PROVIDERS = ["openai", "anthropic", "gemini", "openrouter"] as const;
export type Provider = (typeof PROVIDERS)[number];

export function isProvider(value: string): value is Provider {
  return (PROVIDERS as readonly string[]).includes(value);
}

const ENV_KEY_VARS: Record<Provider, string> = {
  openai: "AI_INTEGRATIONS_OPENAI_API_KEY",
  anthropic: "AI_INTEGRATIONS_ANTHROPIC_API_KEY",
  gemini: "AI_INTEGRATIONS_GEMINI_API_KEY",
  openrouter: "AI_INTEGRATIONS_OPENROUTER_API_KEY",
};

export function hasEnvKey(provider: Provider): boolean {
  return Boolean(process.env[ENV_KEY_VARS[provider]]);
}

/** Returns the stored (admin-configured) key for a provider, or null. */
export async function getStoredKey(provider: Provider): Promise<string | null> {
  const [row] = await db
    .select()
    .from(providerApiKeysTable)
    .where(eq(providerApiKeysTable.provider, provider));
  return row?.apiKey ?? null;
}

export async function setStoredKey(
  provider: Provider,
  apiKey: string,
): Promise<ProviderApiKeyRow> {
  const [row] = await db
    .insert(providerApiKeysTable)
    .values({ provider, apiKey })
    .onConflictDoUpdate({
      target: providerApiKeysTable.provider,
      set: { apiKey, updatedAt: new Date() },
    })
    .returning();
  if (!row) throw new Error("Failed to store API key");
  return row;
}

export async function deleteStoredKey(provider: Provider): Promise<void> {
  await db
    .delete(providerApiKeysTable)
    .where(eq(providerApiKeysTable.provider, provider));
}

export interface ProviderKeyStatus {
  provider: Provider;
  hasStoredKey: boolean;
  maskedKey: string | null;
  hasEnvKey: boolean;
  updatedAt: string | null;
}

function mask(key: string): string {
  return `••••${key.slice(-4)}`;
}

export async function keyStatuses(): Promise<ProviderKeyStatus[]> {
  const rows = await db.select().from(providerApiKeysTable);
  return PROVIDERS.map((provider) => {
    const row = rows.find((r) => r.provider === provider);
    return {
      provider,
      hasStoredKey: Boolean(row),
      maskedKey: row ? mask(row.apiKey) : null,
      hasEnvKey: hasEnvKey(provider),
      updatedAt: row ? row.updatedAt.toISOString() : null,
    };
  });
}

export function statusFor(
  provider: Provider,
  row: ProviderApiKeyRow | null,
): ProviderKeyStatus {
  return {
    provider,
    hasStoredKey: Boolean(row),
    maskedKey: row ? mask(row.apiKey) : null,
    hasEnvKey: hasEnvKey(provider),
    updatedAt: row ? row.updatedAt.toISOString() : null,
  };
}
