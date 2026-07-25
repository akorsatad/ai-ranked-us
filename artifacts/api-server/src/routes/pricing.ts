import { Router, type IRouter } from "express";
import { asc, eq } from "drizzle-orm";
import { db, pricingTiersTable, type PricingTierRow } from "@workspace/db";
import { requireAdmin } from "../middlewares/requireAdmin";
import { UpdatePricingTierBody } from "@workspace/api-zod";

function serialize(t: PricingTierRow) {
  return {
    key: t.key,
    name: t.name,
    blurb: t.blurb,
    monthlyPriceUsd: t.monthlyPriceUsd,
    costPerTokenUsd: t.costPerTokenUsd,
    includedTokens: t.includedTokens,
    features: t.features ?? [],
    highlighted: t.highlighted,
    sortOrder: t.sortOrder,
    updatedAt: t.updatedAt.toISOString(),
  };
}

const router: IRouter = Router();

// Public: the pricing tiers shown on the marketing site.
router.get("/pricing", async (_req, res): Promise<void> => {
  const tiers = await db
    .select()
    .from(pricingTiersTable)
    .orderBy(asc(pricingTiersTable.sortOrder));
  res.status(200).json({ tiers: tiers.map(serialize) });
});

// Admin: same list, for the pricing editor.
router.get("/admin/pricing", requireAdmin, async (_req, res): Promise<void> => {
  const tiers = await db
    .select()
    .from(pricingTiersTable)
    .orderBy(asc(pricingTiersTable.sortOrder));
  res.status(200).json({ tiers: tiers.map(serialize) });
});

// Admin: update a tier's economics (per-token rate, monthly fee, included
// tokens). Other display fields stay as seeded.
router.put(
  "/admin/pricing/:key",
  requireAdmin,
  async (req, res): Promise<void> => {
    const key = String(req.params.key);
    const body = UpdatePricingTierBody.safeParse(req.body);
    if (!body.success) {
      res.status(400).json({ message: "Invalid pricing values" });
      return;
    }
    const { costPerTokenUsd, monthlyPriceUsd, includedTokens } = body.data;
    if (costPerTokenUsd != null && (costPerTokenUsd < 0 || costPerTokenUsd > 1)) {
      res.status(400).json({ message: "costPerTokenUsd must be between 0 and 1" });
      return;
    }
    if (monthlyPriceUsd != null && monthlyPriceUsd < 0) {
      res.status(400).json({ message: "monthlyPriceUsd cannot be negative" });
      return;
    }
    if (includedTokens != null && includedTokens < 0) {
      res.status(400).json({ message: "includedTokens cannot be negative" });
      return;
    }

    const patch: Partial<PricingTierRow> = {};
    if (costPerTokenUsd != null) patch.costPerTokenUsd = costPerTokenUsd;
    // monthlyPriceUsd is nullable: an explicit null clears it (custom pricing).
    if (monthlyPriceUsd !== undefined) patch.monthlyPriceUsd = monthlyPriceUsd;
    if (includedTokens != null) patch.includedTokens = includedTokens;

    const [updated] = await db
      .update(pricingTiersTable)
      .set(patch)
      .where(eq(pricingTiersTable.key, key))
      .returning();
    if (!updated) {
      res.status(404).json({ message: "Pricing tier not found" });
      return;
    }
    req.log.info({ key, ...patch }, "Pricing tier updated");
    res.status(200).json(serialize(updated));
  },
);

export default router;
