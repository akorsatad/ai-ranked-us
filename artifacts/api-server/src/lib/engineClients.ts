import type { EngineRow } from "@workspace/db";

/**
 * Calls a single AI engine with a single, fully isolated one-shot prompt.
 * No conversation state or shared context is ever reused between calls.
 *
 * Clients are imported lazily so the server can boot even when an AI
 * integration has not been provisioned yet; such calls fail loudly at
 * survey time instead.
 */
export async function callEngine(
  engine: EngineRow,
  prompt: string,
): Promise<string> {
  switch (engine.provider) {
    case "openai": {
      const { openai } = await import(
        "@workspace/integrations-openai-ai-server"
      );
      const response = await openai.chat.completions.create({
        model: engine.model,
        max_completion_tokens: 8192,
        messages: [{ role: "user", content: prompt }],
        response_format: { type: "json_object" },
      });
      return response.choices[0]?.message?.content ?? "";
    }
    case "anthropic": {
      const { anthropic } = await import(
        "@workspace/integrations-anthropic-ai"
      );
      const message = await anthropic.messages.create({
        model: engine.model,
        max_tokens: 8192,
        messages: [{ role: "user", content: prompt }],
      });
      const block = message.content[0];
      return block && block.type === "text" ? block.text : "";
    }
    case "gemini": {
      const { ai } = await import("@workspace/integrations-gemini-ai");
      const response = await ai.models.generateContent({
        model: engine.model,
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        config: { maxOutputTokens: 8192, responseMimeType: "application/json" },
      });
      return response.text ?? "";
    }
    case "openrouter": {
      const { openrouter } = await import(
        "@workspace/integrations-openrouter-ai"
      );
      const response = await openrouter.chat.completions.create({
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
