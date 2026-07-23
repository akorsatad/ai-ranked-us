import { Router, type IRouter } from "express";
import { db, industriesTable, brandsTable, enginesTable } from "@workspace/db";
import { METRICS } from "../lib/metrics";

const router: IRouter = Router();

router.get("/catalog", async (_req, res): Promise<void> => {
  const [allIndustries, allBrands, allEngines] = await Promise.all([
    db.select().from(industriesTable),
    db.select().from(brandsTable),
    db.select().from(enginesTable),
  ]);
  const industries = allIndustries.filter((i) => i.enabled);
  const enabledIndustryIds = new Set(industries.map((i) => i.id));
  const brands = allBrands.filter(
    (b) => b.enabled && enabledIndustryIds.has(b.industryId),
  );
  const engines = allEngines.filter((e) => e.enabled);
  res.status(200).json({
    industries: industries.filter((i) => i.enabled),
    brands: brands.filter((b) => b.enabled),
    engines: engines.filter((e) => e.enabled).map((e) => ({
      id: e.id,
      key: e.key,
      name: e.name,
      vendor: e.vendor,
    })),
    metrics: METRICS,
  });
  return;
});

export default router;
