import {
  db,
  industriesTable,
  brandsTable,
  enginesTable,
  pricingTiersTable,
  surveySchedulesTable,
} from "@workspace/db";
import { logger } from "./logger";

// Default commercial pricing tiers. Token rates are placeholders admins edit
// in /admin/pricing. Billing is per token used, refillable at the tier rate.
const PRICING_TIERS = [
  {
    key: "starter",
    name: "Starter",
    blurb: "For founders and small brands tracking their own presence.",
    monthlyPriceUsd: 20,
    costPerTokenUsd: 0.00002,
    includedTokens: 1_000_000,
    features: [
      "1M tokens included each month",
      "Rank your brand vs. up to 3 competitors",
      "All 7 perception metrics",
      "Refill tokens anytime at your tier rate",
    ],
    highlighted: false,
    sortOrder: 1,
  },
  {
    key: "pro",
    name: "Pro",
    blurb: "For agencies and teams running brand research at volume.",
    monthlyPriceUsd: 100,
    costPerTokenUsd: 0.000015,
    includedTokens: 6_000_000,
    features: [
      "6M tokens included each month",
      "Unlimited competitors per run",
      "Daily tracking + alerts",
      "Priority engines & lower per-token rate",
      "Refill tokens anytime at your tier rate",
    ],
    highlighted: true,
    sortOrder: 2,
  },
  {
    key: "enterprise",
    name: "Enterprise",
    blurb: "For publishers and enterprises with custom volume and SLAs.",
    monthlyPriceUsd: null,
    costPerTokenUsd: 0.00001,
    includedTokens: 0,
    features: [
      "Custom token volume & lowest per-token rate",
      "Dedicated engines and data export",
      "SSO, audit log, and SLA",
      "White-glove onboarding",
    ],
    highlighted: false,
    sortOrder: 3,
  },
];

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
      "U.S. Bank",
      "PNC Bank",
      "Goldman Sachs",
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
      "Alaska Airlines",
      "Spirit Airlines",
      "Frontier Airlines",
    ],
  },
  {
    name: "Retail",
    slug: "retail",
    brands: [
      "Walmart",
      "Target",
      "Costco",
      "Amazon",
      "The Home Depot",
      "Lowe's",
      "Best Buy",
      "Kroger",
    ],
  },
  {
    name: "Telecom",
    slug: "telecom",
    brands: [
      "Verizon",
      "T-Mobile",
      "AT&T",
      "Xfinity (Comcast)",
      "Spectrum",
      "Mint Mobile",
      "Google Fi",
      "Cox Communications",
    ],
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
      "Subway",
      "Chipotle",
      "Popeyes",
    ],
  },
  {
    name: "Automotive",
    slug: "automotive",
    brands: [
      "Toyota",
      "Ford",
      "Tesla",
      "Honda",
      "Chevrolet",
      "BMW",
      "Hyundai",
      "Subaru",
    ],
  },
  {
    name: "Technology",
    slug: "technology",
    brands: [
      "Apple",
      "Google",
      "Microsoft",
      "Samsung",
      "Meta",
      "Nvidia",
      "Sony",
      "Dell",
    ],
  },
  {
    name: "Insurance",
    slug: "insurance",
    brands: [
      "State Farm",
      "GEICO",
      "Progressive",
      "Allstate",
      "USAA",
      "Liberty Mutual",
      "Nationwide",
      "Farmers Insurance",
    ],
  },
  {
    name: "Streaming",
    slug: "streaming",
    brands: [
      "Netflix",
      "Disney+",
      "Hulu",
      "Max",
      "Amazon Prime Video",
      "Apple TV+",
      "Paramount+",
      "Peacock",
    ],
  },
  {
    name: "Hotels",
    slug: "hotels",
    brands: [
      "Marriott",
      "Hilton",
      "Hyatt",
      "Holiday Inn (IHG)",
      "Best Western",
      "Four Seasons",
      "Wyndham",
      "Motel 6",
    ],
  },
  {
    name: "Grocery Delivery",
    slug: "grocery-delivery",
    brands: [
      "Instacart",
      "DoorDash",
      "Uber Eats",
      "Amazon Fresh",
      "Walmart+",
      "Shipt",
    ],
  },
  {
    name: "Fitness",
    slug: "fitness",
    brands: [
      "Planet Fitness",
      "Peloton",
      "Equinox",
      "LA Fitness",
      "Orangetheory",
      "Crunch Fitness",
    ],
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

/**
 * Idempotent catalog sync: inserts any industries or brands from CATALOG
 * that are missing in the database. Never deletes or modifies existing rows,
 * so admin-made changes (renames, disables, additions) are preserved.
 */
export async function ensureSeeded(): Promise<void> {
  const existingIndustries = await db.select().from(industriesTable);
  const existingBrands = await db.select().from(brandsTable);

  const industryBySlug = new Map(existingIndustries.map((i) => [i.slug, i]));
  let newIndustries = 0;
  let newBrands = 0;

  for (const industry of CATALOG) {
    let row = industryBySlug.get(industry.slug);
    if (!row) {
      const [inserted] = await db
        .insert(industriesTable)
        .values({ name: industry.name, slug: industry.slug, country: "US" })
        .onConflictDoNothing({ target: industriesTable.slug })
        .returning();
      if (!inserted) continue;
      row = inserted;
      industryBySlug.set(industry.slug, row);
      newIndustries++;
    }

    const industryId = row.id;
    const existingNames = new Set(
      existingBrands
        .filter((b) => b.industryId === industryId)
        .map((b) => b.name.toLowerCase()),
    );
    const missing = industry.brands.filter(
      (name) => !existingNames.has(name.toLowerCase()),
    );
    if (missing.length > 0) {
      // onConflictDoNothing guards against races with the admin UI; the
      // unique index on (industry_id, lower(name)) is the source of truth.
      const inserted = await db
        .insert(brandsTable)
        .values(missing.map((name) => ({ industryId, name })))
        .onConflictDoNothing()
        .returning();
      newBrands += inserted.length;
    }
  }

  if (newIndustries > 0 || newBrands > 0) {
    logger.info(
      { newIndustries, newBrands },
      "Synced catalog: added missing industries and brands",
    );
  }

  const existingEngines = await db.select().from(enginesTable);
  if (existingEngines.length === 0) {
    await db.insert(enginesTable).values(ENGINES);
    logger.info("Seeded engines");
  }

  const existingTiers = await db.select().from(pricingTiersTable);
  if (existingTiers.length === 0) {
    await db.insert(pricingTiersTable).values(PRICING_TIERS);
    logger.info("Seeded pricing tiers");
  }

  // Default schedule: a daily full survey run at the next 06:00 UTC. This
  // replaces the old implicit daily cron behavior with an editable schedule.
  const existingSchedules = await db.select().from(surveySchedulesTable);
  if (existingSchedules.length === 0) {
    const next = new Date();
    next.setUTCHours(6, 0, 0, 0);
    if (next.getTime() <= Date.now()) next.setUTCDate(next.getUTCDate() + 1);
    await db.insert(surveySchedulesTable).values({
      mode: "recurring",
      cadence: "daily",
      enabled: true,
      nextRunAt: next,
    });
    logger.info("Seeded default daily survey schedule");
  }
}
