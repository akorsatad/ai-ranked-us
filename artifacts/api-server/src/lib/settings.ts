import { eq } from "drizzle-orm";
import { db, appSettingsTable } from "@workspace/db";

export const PROVIDERS = [
  "openai",
  "anthropic",
  "gemini",
  "openrouter",
] as const;
export type Provider = (typeof PROVIDERS)[number];

const apiKeySetting = (provider: Provider) => `api_key_${provider}`;

export async function getStoredApiKey(
  provider: Provider,
): Promise<string | null> {
  const [row] = await db
    .select()
    .from(appSettingsTable)
    .where(eq(appSettingsTable.key, apiKeySetting(provider)));
  return row?.value ?? null;
}

export async function setStoredApiKey(
  provider: Provider,
  apiKey: string,
): Promise<void> {
  const key = apiKeySetting(provider);
  if (!apiKey) {
    await db.delete(appSettingsTable).where(eq(appSettingsTable.key, key));
    return;
  }
  await db
    .insert(appSettingsTable)
    .values({ key, value: apiKey, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: appSettingsTable.key,
      set: { value: apiKey, updatedAt: new Date() },
    });
}

export function envKeyPresent(provider: Provider): boolean {
  return Boolean(
    process.env[`AI_INTEGRATIONS_${provider.toUpperCase()}_API_KEY`],
  );
}

export async function apiKeyStatus(provider: Provider): Promise<{
  provider: Provider;
  maskedKey: string | null;
  source: "stored" | "env" | "none";
}> {
  const stored = await getStoredApiKey(provider);
  return {
    provider,
    maskedKey: stored ? `••••${stored.slice(-4)}` : null,
    source: stored ? "stored" : envKeyPresent(provider) ? "env" : "none",
  };
}
