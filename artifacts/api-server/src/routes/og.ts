import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, industriesTable } from "@workspace/db";
import { METRICS } from "../lib/metrics";
import { latestResponsesByEngine, averageEntries } from "../lib/aggregate";
import { renderIndustryOgImage } from "../lib/og";

const router: IRouter = Router();

/**
 * Dynamic 1200x630 Open Graph image for an industry ranking page.
 * Falls back to 404 (frontend meta tags fall back to the site-wide image).
 */
router.get("/og/industries/:industryId/image.png", async (req, res): Promise<void> => {
  const industryId = Number(req.params.industryId);
  if (!Number.isInteger(industryId) || industryId <= 0) {
    res.status(400).json({ message: "Invalid industry id" });
    return;
  }
  const [industry] = await db
    .select()
    .from(industriesTable)
    .where(eq(industriesTable.id, industryId));
  if (!industry || !industry.enabled) {
    res.status(404).json({ message: "Industry not found" });
    return;
  }

  const metric = METRICS[0];
  const responses = await latestResponsesByEngine(industry.id, metric.key);
  const entries = averageEntries(
    responses.map((r) => r.response),
    metric.higherIsBetter,
  );
  const topBrands = entries.slice(0, 5).map((e) => ({
    rank: e.rank,
    name: e.brandName,
    score: e.score,
  }));

  const latestSurveyedAt = responses.reduce(
    (max, r) => Math.max(max, r.response.createdAt.getTime()),
    0,
  );
  const cacheKey = `industry:${industry.id}:${metric.key}:${latestSurveyedAt}`;

  try {
    const png = renderIndustryOgImage(cacheKey, {
      industryName: industry.name,
      metricLabel: metric.label,
      topBrands,
    });
    res
      .status(200)
      .setHeader("Content-Type", "image/png")
      .setHeader("Cache-Control", "public, max-age=600")
      .send(png);
  } catch (err) {
    req.log.error({ err }, "Failed to render OG image");
    res.status(500).json({ message: "Failed to render image" });
  }
  return;
});

export default router;
