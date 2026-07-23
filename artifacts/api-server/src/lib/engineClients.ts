import type { EngineRow } from "@workspace/db";
import { getStoredApiKey, type Provider } from "./settings";

/**
 * Calls a single AI engine with a single, fully isolated one-shot prompt.
 * No conversation state or shared context is ever reused between calls.
 *
 * Key resolution: a key stored via the admin API Keys page takes precedence
 * and is used against the provider's public API endpoint; otherwise the
 * Replit AI Integrations client (env-provisioned) is used. SDK modules are
 * imported lazily so the server can boot even when an AI integration has not
 * been provisioned yet; such calls fail loudly at survey time instead.
 */
export async function callEngine(
  engine: EngineRow,
  prompt: string,
): Promise<string> {
  const provider = engine.provider as Provider;
  const storedKey = await getStoredApiKey(provider);

  switch (provider) {
    case "openai": {
      let client;
      if (storedKey) {
        const { default: OpenAI } = await import("openai");
        client = new OpenAI({ apiKey: storedKey });
      } else {
        client = (await import("@workspace/integrations-openai-ai-server"))
          .openai;
      }
      const response = await client.chat.completions.create({
        model: engine.model,
        max_completion_tokens: 8192,
        messages: [{ role: "user", content: prompt }],
        response_format: { type: "json_object" },
      });
      return response.choices[0]?.message?.content ?? "";
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
      const message = await client.messages.create({
        model: engine.model,
        max_tokens: 8192,
        messages: [{ role: "user", content: prompt }],
      });
      const block = message.content[0];
      return block && block.type === "text" ? block.text : "";
    }
    case "gemini": {
      let client;
      if (storedKey) {
        const { GoogleGenAI } = await import("@google/genai");
        client = new GoogleGenAI({ apiKey: storedKey });
      } else {
        client = (await import("@workspace/integrations-gemini-ai")).ai;
      }
      const response = await client.models.generateContent({
        model: engine.model,
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        config: { maxOutputTokens: 8192, responseMimeType: "application/json" },
      });
      return response.text ?? "";
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
      const response = await client.chat.completions.create({
        model: engine.model,
        max_tokens: 8192,
        messages: [{ role: "user", content: prompt }],
      });
      return response.choices[0]?.message?.content ?? "";
    }
    default:
      throw new Error(`Unknown engine provider: ${engine.provider}`);
  }
}
