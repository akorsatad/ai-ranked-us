import type { EngineRow } from "@workspace/db";
import { getStoredKey, isProvider } from "./apiKeys";

export interface EngineCallResult {
  text: string;
  /** Model name reported by the provider (falls back to the requested model). */
  resolvedModel: string;
  inputTokens: number | null;
  outputTokens: number | null;
}

/**
 * Hard ceiling on a single engine call. Without this a stalled socket blocks a
 * concurrency slot indefinitely, so the whole survey run can sit in "running"
 * forever (the exact failure this guard exists to prevent). Overridable via
 * ENGINE_CALL_TIMEOUT_MS; defaults to 120s, comfortably above a normal
 * 8k-token completion but well short of an infinite hang.
 */
export const ENGINE_CALL_TIMEOUT_MS = (() => {
  const raw = Number(process.env.ENGINE_CALL_TIMEOUT_MS);
  return Number.isFinite(raw) && raw >= 10_000 ? raw : 120_000;
})();

export class EngineTimeoutError extends Error {
  constructor(label: string, ms: number) {
    super(`${label} timed out after ${ms}ms`);
    this.name = "EngineTimeoutError";
  }
}

/**
 * Runs a provider call with an abort-backed hard timeout. The AbortSignal is
 * handed to SDKs that honor it (best-effort socket cancellation); the
 * Promise.race guarantees the call rejects and frees its slot even if the SDK
 * ignores the signal.
 */
async function withTimeout<T>(
  label: string,
  fn: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const guard = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new EngineTimeoutError(label, ENGINE_CALL_TIMEOUT_MS));
    }, ENGINE_CALL_TIMEOUT_MS);
  });
  try {
    return await Promise.race([fn(controller.signal), guard]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Calls a single AI engine with a single, fully isolated one-shot prompt.
 * No conversation state or shared context is ever reused between calls.
 *
 * Key resolution: an admin-configured key stored in the database takes
 * precedence over the environment-variable (Replit AI integration) key.
 * Stored keys talk directly to the provider's own API endpoint; env keys
 * go through the pre-configured integration clients.
 *
 * Clients are imported lazily so the server can boot even when an AI
 * integration has not been provisioned yet; such calls fail loudly at
 * survey time instead.
 */
export async function callEngine(
  engine: EngineRow,
  model: string,
  prompt: string,
): Promise<EngineCallResult> {
  const storedKey = isProvider(engine.provider)
    ? await getStoredKey(engine.provider)
    : null;

  switch (engine.provider) {
    case "openai": {
      let client;
      if (storedKey) {
        const { default: OpenAI } = await import("openai");
        client = new OpenAI({ apiKey: storedKey });
      } else {
        client = (await import("@workspace/integrations-openai-ai-server"))
          .openai;
      }
      const response = await withTimeout(`openai:${model}`, (signal) =>
        client.chat.completions.create(
          {
            model: model,
            max_completion_tokens: 8192,
            messages: [{ role: "user", content: prompt }],
            response_format: { type: "json_object" },
          },
          { signal, maxRetries: 0 },
        ),
      );
      return {
        text: response.choices[0]?.message?.content ?? "",
        resolvedModel: response.model || model,
        inputTokens: response.usage?.prompt_tokens ?? null,
        outputTokens: response.usage?.completion_tokens ?? null,
      };
    }
    case "anthropic": {
      let client;
      if (storedKey) {
        const { default: Anthropic } = await import("@anthropic-ai/sdk");
        client = new Anthropic({ apiKey: storedKey });
      } else {
        client = (await import("@workspace/integrations-anthropic-ai"))
          .anthropic;
      }
      const message = await withTimeout(`anthropic:${model}`, (signal) =>
        client.messages.create(
          {
            model: model,
            max_tokens: 8192,
            messages: [{ role: "user", content: prompt }],
          },
          { signal, maxRetries: 0 },
        ),
      );
      const block = message.content[0];
      return {
        text: block && block.type === "text" ? block.text : "",
        resolvedModel: message.model || model,
        inputTokens: message.usage?.input_tokens ?? null,
        outputTokens: message.usage?.output_tokens ?? null,
      };
    }
    case "gemini": {
      let client;
      if (storedKey) {
        const { GoogleGenAI } = await import("@google/genai");
        client = new GoogleGenAI({ apiKey: storedKey });
      } else {
        client = (await import("@workspace/integrations-gemini-ai")).ai;
      }
      const response = await withTimeout(`gemini:${model}`, (signal) =>
        client.models.generateContent({
          model: model,
          contents: [{ role: "user", parts: [{ text: prompt }] }],
          config: {
            maxOutputTokens: 8192,
            responseMimeType: "application/json",
            abortSignal: signal,
          },
        }),
      );
      const usage = response.usageMetadata;
      const outputTokens =
        usage?.candidatesTokenCount != null || usage?.thoughtsTokenCount != null
          ? (usage?.candidatesTokenCount ?? 0) + (usage?.thoughtsTokenCount ?? 0)
          : null;
      return {
        text: response.text ?? "",
        resolvedModel: response.modelVersion || model,
        inputTokens: usage?.promptTokenCount ?? null,
        outputTokens,
      };
    }
    case "openrouter": {
      let client;
      if (storedKey) {
        const { default: OpenAI } = await import("openai");
        client = new OpenAI({
          apiKey: storedKey,
          baseURL: "https://openrouter.ai/api/v1",
        });
      } else {
        client = (await import("@workspace/integrations-openrouter-ai"))
          .openrouter;
      }
      const response = await withTimeout(`openrouter:${model}`, (signal) =>
        client.chat.completions.create(
          {
            model: model,
            max_tokens: 8192,
            messages: [{ role: "user", content: prompt }],
          },
          { signal, maxRetries: 0 },
        ),
      );
      return {
        text: response.choices[0]?.message?.content ?? "",
        resolvedModel: response.model || model,
        inputTokens: response.usage?.prompt_tokens ?? null,
        outputTokens: response.usage?.completion_tokens ?? null,
      };
    }
    default:
      throw new Error(`Unknown engine provider: ${engine.provider}`);
  }
}
