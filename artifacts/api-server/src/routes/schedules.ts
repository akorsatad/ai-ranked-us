import { Router, type IRouter } from "express";
import { asc, eq } from "drizzle-orm";
import {
  db,
  surveySchedulesTable,
  industriesTable,
  enginesTable,
  type SurveyScheduleRow,
} from "@workspace/db";
import { requireAdmin } from "../middlewares/requireAdmin";
import {
  isCadence,
  nextDailyRun,
  ensurePerIndustrySchedules,
  type Cadence,
} from "../lib/schedules";

function serialize(s: SurveyScheduleRow) {
  return {
    id: s.id,
    mode: s.mode,
    cadence: s.cadence,
    industryId: s.industryId ?? null,
    engineId: s.engineId ?? null,
    enabled: s.enabled,
    nextRunAt: s.nextRunAt.toISOString(),
    lastRunAt: s.lastRunAt ? s.lastRunAt.toISOString() : null,
    lastRunId: s.lastRunId ?? null,
    createdAt: s.createdAt.toISOString(),
  };
}

/** Parse an incoming schedule body into validated fields (or an error). */
async function parseScheduleBody(body: unknown): Promise<
  | {
      ok: true;
      mode: "once" | "recurring";
      cadence: Cadence | null;
      industryId: number | null;
      engineId: number | null;
      nextRunAt: Date;
    }
  | { ok: false; message: string }
> {
  const b = (body ?? {}) as Record<string, unknown>;

  const mode = b.mode === "once" ? "once" : b.mode === "recurring" ? "recurring" : null;
  if (!mode) return { ok: false, message: "mode must be 'once' or 'recurring'" };

  let cadence: Cadence | null = null;
  if (mode === "recurring") {
    if (!isCadence(b.cadence))
      return { ok: false, message: "cadence must be daily, weekly, or monthly" };
    cadence = b.cadence;
  }

  let nextRunAt: Date;
  if (mode === "once") {
    if (typeof b.runAt !== "string")
      return { ok: false, message: "runAt (ISO datetime) is required for a one-time schedule" };
    const d = new Date(b.runAt);
    if (Number.isNaN(d.getTime()))
      return { ok: false, message: "runAt is not a valid datetime" };
    nextRunAt = d;
  } else {
    // Recurring: start at the provided runAt, else the next daily slot.
    if (typeof b.runAt === "string" && !Number.isNaN(new Date(b.runAt).getTime())) {
      nextRunAt = new Date(b.runAt);
    } else {
      nextRunAt = nextDailyRun();
    }
  }

  let industryId: number | null = null;
  if (b.industryId != null) {
    const id = Number(b.industryId);
    if (!Number.isInteger(id) || id <= 0)
      return { ok: false, message: "industryId must be a positive integer" };
    const [row] = await db.select().from(industriesTable).where(eq(industriesTable.id, id));
    if (!row) return { ok: false, message: "Industry not found" };
    industryId = id;
  }

  let engineId: number | null = null;
  if (b.engineId != null) {
    const id = Number(b.engineId);
    if (!Number.isInteger(id) || id <= 0)
      return { ok: false, message: "engineId must be a positive integer" };
    const [row] = await db.select().from(enginesTable).where(eq(enginesTable.id, id));
    if (!row) return { ok: false, message: "Engine not found" };
    engineId = id;
  }

  return { ok: true, mode, cadence, industryId, engineId, nextRunAt };
}

const router: IRouter = Router();

router.get("/admin/schedules", requireAdmin, async (_req, res): Promise<void> => {
  const rows = await db
    .select()
    .from(surveySchedulesTable)
    .orderBy(asc(surveySchedulesTable.nextRunAt));
  res.status(200).json({ schedules: rows.map(serialize) });
});

// Replace the single full-scope daily schedule with one per enabled industry,
// so each run finishes in a single cron invocation instead of stalling.
router.post(
  "/admin/schedules/split-by-industry",
  requireAdmin,
  async (_req, res): Promise<void> => {
    const result = await ensurePerIndustrySchedules();
    res.status(200).json({
      ...result,
      message: `Created ${result.created} per-industry schedule(s); disabled ${result.disabledFullRuns} full-run schedule(s).`,
    });
  },
);

router.post("/admin/schedules", requireAdmin, async (req, res): Promise<void> => {
  const parsed = await parseScheduleBody(req.body);
  if (!parsed.ok) {
    res.status(400).json({ message: parsed.message });
    return;
  }
  const [row] = await db
    .insert(surveySchedulesTable)
    .values({
      mode: parsed.mode,
      cadence: parsed.cadence,
      industryId: parsed.industryId,
      engineId: parsed.engineId,
      enabled: true,
      nextRunAt: parsed.nextRunAt,
    })
    .returning();
  if (!row) {
    res.status(500).json({ message: "Failed to create schedule" });
    return;
  }
  req.log.info({ scheduleId: row.id, mode: row.mode }, "Schedule created");
  res.status(201).json(serialize(row));
});

router.patch("/admin/schedules/:id", requireAdmin, async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ message: "Invalid schedule id" });
    return;
  }
  const [existing] = await db
    .select()
    .from(surveySchedulesTable)
    .where(eq(surveySchedulesTable.id, id));
  if (!existing) {
    res.status(404).json({ message: "Schedule not found" });
    return;
  }

  const b = (req.body ?? {}) as Record<string, unknown>;
  const patch: Partial<SurveyScheduleRow> = {};

  // Enable/disable is a standalone toggle.
  if (typeof b.enabled === "boolean") patch.enabled = b.enabled;

  // Switching mode / cadence — the editable-trigger feature.
  if (b.mode === "once" || b.mode === "recurring") {
    patch.mode = b.mode;
    if (b.mode === "recurring") {
      const cadence = isCadence(b.cadence)
        ? b.cadence
        : isCadence(existing.cadence)
          ? existing.cadence
          : "daily";
      patch.cadence = cadence;
    } else {
      patch.cadence = null;
    }
  } else if (isCadence(b.cadence)) {
    patch.cadence = b.cadence;
  }

  if (b.industryId !== undefined) {
    if (b.industryId === null) patch.industryId = null;
    else {
      const nid = Number(b.industryId);
      if (Number.isInteger(nid) && nid > 0) patch.industryId = nid;
    }
  }
  if (b.engineId !== undefined) {
    if (b.engineId === null) patch.engineId = null;
    else {
      const nid = Number(b.engineId);
      if (Number.isInteger(nid) && nid > 0) patch.engineId = nid;
    }
  }
  if (typeof b.runAt === "string") {
    const d = new Date(b.runAt);
    if (!Number.isNaN(d.getTime())) patch.nextRunAt = d;
  }

  const [row] = await db
    .update(surveySchedulesTable)
    .set(patch)
    .where(eq(surveySchedulesTable.id, id))
    .returning();
  req.log.info({ scheduleId: id }, "Schedule updated");
  res.status(200).json(serialize(row ?? existing));
});

router.delete("/admin/schedules/:id", requireAdmin, async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ message: "Invalid schedule id" });
    return;
  }
  const deleted = await db
    .delete(surveySchedulesTable)
    .where(eq(surveySchedulesTable.id, id))
    .returning({ id: surveySchedulesTable.id });
  if (deleted.length === 0) {
    res.status(404).json({ message: "Schedule not found" });
    return;
  }
  req.log.info({ scheduleId: id }, "Schedule deleted");
  res.status(200).json({ message: "Schedule deleted" });
});

export default router;
