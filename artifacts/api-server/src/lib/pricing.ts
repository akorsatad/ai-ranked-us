/**
 * Static per-model pricing table (USD per 1M tokens).
 *
 * Prices are estimates for cost tracking; update this table when providers
 * change pricing. Lookup is by longest matching prefix of the resolved model
 * name (lowercased), so dated variants like "gpt-5-2025-08-07" match "gpt-5".
 */
export interface ModelPrice {
  inputPerM: number;
  outputPerM: number;
}

const PRICES: Record<string, ModelPrice> = {
  // OpenAI
  "gpt-5-mini": { inputPerM: 0.25, outputPerM: 2.0 },
  "gpt-5-nano": { inputPerM: 0.05, outputPerM: 0.4 },
  "gpt-5": { inputPerM: 1.25, outputPerM: 10.0 },
  "gpt-4.1-mini": { inputPerM: 0.4, outputPerM: 1.6 },
  "gpt-4.1-nano": { inputPerM: 0.1, outputPerM: 0.4 },
  "gpt-4.1": { inputPerM: 2.0, outputPerM: 8.0 },
  "gpt-4o-mini": { inputPerM: 0.15, outputPerM: 0.6 },
  "gpt-4o": { inputPerM: 2.5, outputPerM: 10.0 },
  "o3-mini": { inputPerM: 1.1, outputPerM: 4.4 },
  o3: { inputPerM: 2.0, outputPerM: 8.0 },
  "o4-mini": { inputPerM: 1.1, outputPerM: 4.4 },
  // Anthropic
  "claude-sonnet-4-6": { inputPerM: 3.0, outputPerM: 15.0 },
  "claude-opus-4": { inputPerM: 15.0, outputPerM: 75.0 },
  "claude-sonnet-4": { inputPerM: 3.0, outputPerM: 15.0 },
  "claude-3-7-sonnet": { inputPerM: 3.0, outputPerM: 15.0 },
  "claude-3-5-sonnet": { inputPerM: 3.0, outputPerM: 15.0 },
  "claude-3-5-haiku": { inputPerM: 0.8, outputPerM: 4.0 },
  "claude-haiku-4": { inputPerM: 1.0, outputPerM: 5.0 },
  // Gemini
  "gemini-3-pro": { inputPerM: 2.0, outputPerM: 12.0 },
  "gemini-3-flash": { inputPerM: 0.3, outputPerM: 2.5 },
  "gemini-2.5-pro": { inputPerM: 1.25, outputPerM: 10.0 },
  "gemini-2.5-flash-lite": { inputPerM: 0.1, outputPerM: 0.4 },
  "gemini-2.5-flash": { inputPerM: 0.3, outputPerM: 2.5 },
  "gemini-2.0-flash-lite": { inputPerM: 0.075, outputPerM: 0.3 },
  "gemini-2.0-flash": { inputPerM: 0.1, outputPerM: 0.4 },
  // OpenRouter-hosted models (model ids look like "vendor/model")
  "meta-llama/llama-3.3-70b-instruct": { inputPerM: 0.1, outputPerM: 0.25 },
  "meta-llama/llama-3.1-405b-instruct": { inputPerM: 0.8, outputPerM: 0.8 },
  "mistralai/mistral-large": { inputPerM: 2.0, outputPerM: 6.0 },
  "deepseek/deepseek-chat": { inputPerM: 0.27, outputPerM: 1.1 },
  "x-ai/grok-4.5": { inputPerM: 3.0, outputPerM: 15.0 },
  "x-ai/grok-4": { inputPerM: 3.0, outputPerM: 15.0 },
  "x-ai/grok-3-mini": { inputPerM: 0.3, outputPerM: 0.5 },
  "x-ai/grok-3": { inputPerM: 3.0, outputPerM: 15.0 },
};

// Sorted longest-first so the most specific prefix wins.
const PREFIXES = Object.keys(PRICES).sort((a, b) => b.length - a.length);

export function findModelPrice(model: string): ModelPrice | null {
  const normalized = model.toLowerCase().trim();
  // Strip openrouter-style provider prefix only if the full id doesn't match.
  for (const prefix of PREFIXES) {
    if (normalized.startsWith(prefix)) return PRICES[prefix] ?? null;
  }
  const slashIdx = normalized.indexOf("/");
  if (slashIdx >= 0) {
    const bare = normalized.slice(slashIdx + 1);
    for (const prefix of PREFIXES) {
      if (bare.startsWith(prefix)) return PRICES[prefix] ?? null;
    }
  }
  return null;
}

/**
 * Estimate the cost of a call in USD. Returns null when the model has no
 * entry in the pricing table (cost is then unknown rather than silently 0).
 */
export function estimateCostUsd(
  model: string,
  inputTokens: number,
  outputTokens: number,
): number | null {
  const price = findModelPrice(model);
  if (!price) return null;
  const cost =
    (inputTokens / 1_000_000) * price.inputPerM +
    (outputTokens / 1_000_000) * price.outputPerM;
  return Math.round(cost * 1_000_000) / 1_000_000;
}
