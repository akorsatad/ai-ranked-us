import {
  db,
  industriesTable,
  brandsTable,
  enginesTable,
} from "@workspace/db";
import { logger } from "./logger";

const CATALOG: { name: string; slug: string; brands: string[] }[] = [
  {
    name: "Banking",
    slug: "banking",
    brands: [
      "JPMorgan Chase",
      "Bank of America",
      "Wells Fargo",
      "Citibank",
      "Capital One",
    ],
  },
  {
    name: "Airlines",
    slug: "airlines",
    brands: [
      "Delta Air Lines",
      "United Airlines",
      "American Airlines",
      "Southwest Airlines",
      "JetBlue",
    ],
  },
  {
    name: "Retail",
    slug: "retail",
    brands: ["Walmart", "Target", "Costco", "Amazon", "The Home Depot"],
  },
  {
    name: "Telecom",
    slug: "telecom",
    brands: ["Verizon", "T-Mobile", "AT&T", "Xfinity (Comcast)", "Spectrum"],
  },
  {
    name: "Fast Food",
    slug: "fast-food",
    brands: [
      "McDonald's",
      "Chick-fil-A",
      "Wendy's",
      "Taco Bell",
      "Burger King",
    ],
  },
  {
    name: "Automotive",
    slug: "automotive",
    brands: ["Toyota", "Ford", "Tesla", "Honda", "Chevrolet"],
  },
  {
    name: "Technology",
    slug: "technology",
    brands: ["Apple", "Google", "Microsoft", "Samsung", "Meta"],
  },
];

const ENGINES: {
  key: string;
  name: string;
  vendor: string;
  provider: string;
  model: string;
}[] = [
  {
    key: "gpt",
    name: "ChatGPT (GPT-5)",
    vendor: "OpenAI",
    provider: "openai",
    model: "gpt-5-mini",
  },
  {
    key: "claude",
    name: "Claude Sonnet",
    vendor: "Anthropic",
    provider: "anthropic",
    model: "claude-sonnet-4-6",
  },
  {
    key: "gemini",
    name: "Gemini Flash",
    vendor: "Google",
    provider: "gemini",
    model: "gemini-3-flash-preview",
  },
  {
    key: "grok",
    name: "Grok",
    vendor: "xAI",
    provider: "openrouter",
    model: "x-ai/grok-4.5",
  },
];

export async function ensureSeeded(): Promise<void> {
  const existing = await db.select().from(industriesTable);
  if (existing.length === 0) {
    for (const industry of CATALOG) {
      const [row] = await db
        .insert(industriesTable)
        .values({ name: industry.name, slug: industry.slug, country: "US" })
        .returning();
      if (!row) continue;
      await db
        .insert(brandsTable)
        .values(industry.brands.map((name) => ({ industryId: row.id, name })));
    }
    logger.info("Seeded industries and brands");
  }

  const existingEngines = await db.select().from(enginesTable);
  if (existingEngines.length === 0) {
    await db.insert(enginesTable).values(ENGINES);
    logger.info("Seeded engines");
  }
}
