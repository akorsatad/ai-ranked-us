import { Router, type IRouter } from "express";
import { desc, eq, count } from "drizzle-orm";
import { db, brandAlertsTable, type BrandAlertRow } from "@workspace/db";
import {
  ListAlertsQueryParams,
  MarkAlertsReadBody,
  UpdateAlertSettingsBody,
} from "@workspace/api-zod";
import { getAlertSettings, setAlertSettings } from "../lib/alerts";

const router: IRouter = Router();

function serializeAlert(alert: BrandAlertRow) {
  const isScore = alert.kind === "score_drop";
  const scale = isScore ? 10 : 1;
  return {
    id: alert.id,
    runId: alert.runId,
    brandId: alert.brandId,
    brandName: alert.brandName,
    industryId: alert.industryId,
    industryName: alert.industryName,
    metric: alert.metricKey,
    metricLabel: alert.metricLabel,
    kind: alert.kind as "score_drop" | "rank_drop",
    previousValue: alert.previousValue / scale,
    currentValue: alert.currentValue / scale,
    delta: alert.delta / scale,
    threshold: alert.threshold / scale,
    read: alert.read,
    createdAt: alert.createdAt.toISOString(),
  };
}

router.get("/alerts", async (req, res): Promise<void> => {
  const query = ListAlertsQueryParams.safeParse(req.query);
  if (!query.success) {
    res.status(400).json({ message: "Invalid parameters" });
    return;
  }
  const limit = Math.min(Math.max(query.data.limit ?? 100, 1), 500);
  const where =
    query.data.unreadOnly === true
      ? eq(brandAlertsTable.read, false)
      : undefined;

  const [alerts, [unread]] = await Promise.all([
    where
      ? db
          .select()
          .from(brandAlertsTable)
          .where(where)
          .orderBy(desc(brandAlertsTable.createdAt), desc(brandAlertsTable.id))
          .limit(limit)
      : db
          .select()
          .from(brandAlertsTable)
          .orderBy(desc(brandAlertsTable.createdAt), desc(brandAlertsTable.id))
          .limit(limit),
    db
      .select({ value: count() })
      .from(brandAlertsTable)
      .where(eq(brandAlertsTable.read, false)),
  ]);

  res.status(200).json({
    alerts: alerts.map(serializeAlert),
    unreadCount: unread?.value ?? 0,
  });
  return;
});

router.post("/alerts/mark-read", async (req, res): Promise<void> => {
  const body = MarkAlertsReadBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ message: "Invalid input" });
    return;
  }
  if (body.data.ids && body.data.ids.length > 0) {
    for (const id of body.data.ids) {
      await db
        .update(brandAlertsTable)
        .set({ read: true })
        .where(eq(brandAlertsTable.id, id));
    }
  } else {
    await db
      .update(brandAlertsTable)
      .set({ read: true })
      .where(eq(brandAlertsTable.read, false));
  }
  const [unread] = await db
    .select({ value: count() })
    .from(brandAlertsTable)
    .where(eq(brandAlertsTable.read, false));
  res.status(200).json({ unreadCount: unread?.value ?? 0 });
  return;
});

router.get("/alerts/settings", async (_req, res): Promise<void> => {
  res.status(200).json(await getAlertSettings());
  return;
});

router.put("/alerts/settings", async (req, res): Promise<void> => {
  const body = UpdateAlertSettingsBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ message: "Invalid input" });
    return;
  }
  const updated = await setAlertSettings({
    scoreDropThreshold: body.data.scoreDropThreshold,
    rankDropThreshold: body.data.rankDropThreshold,
  });
  res.status(200).json(updated);
  return;
});

export default router;
