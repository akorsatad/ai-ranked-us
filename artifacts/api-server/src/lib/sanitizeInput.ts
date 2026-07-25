/**
 * Sanitization for public free-text input (brand names, competitor names,
 * person names). These strings end up in SQL parameters (already safe via
 * parameterized queries), in LLM prompts (prompt-injection surface), and in
 * rendered UI — so the policy is a strict allowlist:
 *
 *   - Unicode letters/marks/numbers in any script (long brand names in any
 *     language are fine)
 *   - spaces and a small set of punctuation that appears in real brand
 *     names: - & ' ’ . , + ( ) / ! : * ® ™
 *
 * Everything else — quotes, semicolons, angle brackets, braces, backticks,
 * $, =, control/format characters — is stripped, and length is capped, so
 * neither SQL-looking payloads nor code/prompt-injection blocks survive.
 */

export const MAX_BRAND_LENGTH = 60;
export const MAX_PERSON_NAME_LENGTH = 60;
export const MAX_COMPETITORS = 8;
/** Hard cap on how many raw array entries we even look at. */
export const MAX_SUBMITTED_COMPETITORS = 20;

const STRIP_INVISIBLES = /[\p{Cc}\p{Cf}\p{Cs}\p{Co}\p{Cn}]/gu;
const ALLOWED_ONLY = /[^\p{L}\p{M}\p{N} \-&'’.,+()/!:*®™]/gu;

export function sanitizeFreeText(raw: unknown, maxLen: number): string {
  if (typeof raw !== "string") return "";
  return raw
    .normalize("NFC")
    .replace(STRIP_INVISIBLES, " ")
    .replace(ALLOWED_ONLY, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLen)
    .trim();
}

export function sanitizeBrandName(raw: unknown): string {
  return sanitizeFreeText(raw, MAX_BRAND_LENGTH);
}

export function sanitizePersonName(raw: unknown): string {
  return sanitizeFreeText(raw, MAX_PERSON_NAME_LENGTH);
}

/**
 * Sanitizes a submitted competitor list: caps how many entries are read,
 * sanitizes each, drops empties and duplicates (case-insensitive) and the
 * target brand itself, and caps the final count.
 */
export function sanitizeCompetitors(
  raw: unknown,
  brand: string,
): string[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>([brand.toLowerCase()]);
  const out: string[] = [];
  for (const entry of raw.slice(0, MAX_SUBMITTED_COMPETITORS)) {
    const name = sanitizeBrandName(entry);
    if (!name) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(name);
    if (out.length >= MAX_COMPETITORS) break;
  }
  return out;
}

/** Two-letter uppercase country code; anything else falls back to US. */
export function sanitizeCountry(raw: unknown): string {
  if (typeof raw !== "string") return "US";
  const code = raw.trim().toUpperCase();
  return /^[A-Z]{2}$/.test(code) ? code : "US";
}
