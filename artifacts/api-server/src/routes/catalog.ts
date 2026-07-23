import { Router, type IRouter } from "express";
import { db, industriesTable, brandsTable, enginesTable } from "@workspace/db";
import { METRICS } from "../lib/metrics";

const router: IRouter = Router();

router.get("/catalog", async (_req, res): Promise<void> => {
  const [industries, brands, engines] = await Promise.all([
    db.select().from(industriesTable),
    db.select().from(brandsTable),
    db.select().from(enginesTable),
  ]);
  res.status(200).json({
    industries,
    brands,
    engines: engines.map((e) => ({
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
