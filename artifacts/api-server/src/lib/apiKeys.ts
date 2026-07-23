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

export interface ApiKeyTestResult {
  provider: Provider;
  ok: boolean;
  source: "stored" | "env";
  error: string | null;
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

/** Cheap models used for the minimal test generation on env/integration keys. */
const TEST_MODELS: Record<Provider, string> = {
  openai: "gpt-4o-mini",
  anthropic: "claude-haiku-4-5",
  gemini: "gemini-2.5-flash",
  openrouter: "openai/gpt-4o-mini",
};

/**
 * Verifies the active key for a provider by making a minimal live call.
 * Stored keys are checked with a free models-list call against the
 * provider's own API; env/integration keys go through the Replit proxy,
 * which only supports generation endpoints, so those get a 1-token
 * generation instead. Stored keys take precedence over env keys,
 * mirroring engineClients.callEngine resolution.
 * Returns null if no key is configured at all.
 */
export async function testProviderKey(
  provider: Provider,
): Promise<ApiKeyTestResult | null> {
  const storedKey = await getStoredKey(provider);
  const source: "stored" | "env" = storedKey ? "stored" : "env";
  if (!storedKey && !hasEnvKey(provider)) return null;

  try {
    switch (provider) {
      case "openai": {
        if (storedKey) {
          const { default: OpenAI } = await import("openai");
          await new OpenAI({ apiKey: storedKey }).models.list();
        } else {
          const client = (
            await import("@workspace/integrations-openai-ai-server")
          ).openai;
          await client.chat.completions.create({
            model: TEST_MODELS.openai,
            max_completion_tokens: 1,
            messages: [{ role: "user", content: "ping" }],
          });
        }
        break;
      }
      case "anthropic": {
        if (storedKey) {
          const { default: Anthropic } = await import("@anthropic-ai/sdk");
          await new Anthropic({ apiKey: storedKey }).models.list({ limit: 1 });
        } else {
          const client = (await import("@workspace/integrations-anthropic-ai"))
            .anthropic;
          await client.messages.create({
            model: TEST_MODELS.anthropic,
            max_tokens: 1,
            messages: [{ role: "user", content: "ping" }],
          });
        }
        break;
      }
      case "gemini": {
        if (storedKey) {
          const { GoogleGenAI } = await import("@google/genai");
          await new GoogleGenAI({ apiKey: storedKey }).models.list({
            config: { pageSize: 1 },
          });
        } else {
          const client = (await import("@workspace/integrations-gemini-ai")).ai;
          await client.models.generateContent({
            model: TEST_MODELS.gemini,
            contents: [{ role: "user", parts: [{ text: "ping" }] }],
            config: { maxOutputTokens: 1 },
          });
        }
        break;
      }
      case "openrouter": {
        if (storedKey) {
          const { default: OpenAI } = await import("openai");
          await new OpenAI({
            apiKey: storedKey,
            baseURL: "https://openrouter.ai/api/v1",
          }).models.list();
        } else {
          const client = (
            await import("@workspace/integrations-openrouter-ai")
          ).openrouter;
          await client.chat.completions.create({
            model: TEST_MODELS.openrouter,
            max_tokens: 1,
            messages: [{ role: "user", content: "ping" }],
          });
        }
        break;
      }
    }
    return { provider, ok: true, source, error: null };
  } catch (err) {
    return { provider, ok: false, source, error: errorMessage(err) };
  }
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
