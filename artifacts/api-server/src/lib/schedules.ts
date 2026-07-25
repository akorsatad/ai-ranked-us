import { and, asc, eq, lte } from "drizzle-orm";
import {
  db,
  surveySchedulesTable,
  type SurveyScheduleRow,
} from "@workspace/db";

export type ScheduleMode = "once" | "recurring";
export type Cadence = "daily" | "weekly" | "monthly";

export function isCadence(v: unknown): v is Cadence {
  return v === "daily" || v === "weekly" || v === "monthly";
}

const RUN_HOUR_UTC = 6; // matches the daily cron / scheduler

/** Next occurrence of RUN_HOUR_UTC strictly after `from`. */
export function nextDailyRun(from: Date = new Date()): Date {
  const next = new Date(
    Date.UTC(
      from.getUTCFullYear(),
      from.getUTCMonth(),
      from.getUTCDate(),
      RUN_HOUR_UTC,
    ),
  );
  if (next.getTime() <= from.getTime()) next.setUTCDate(next.getUTCDate() + 1);
  return next;
}

/** Advance a recurring schedule's next_run_at by its cadence from `base`. */
export function advanceRecurring(cadence: Cadence, base: Date): Date {
  const d = new Date(base.getTime());
  if (cadence === "daily") d.setUTCDate(d.getUTCDate() + 1);
  else if (cadence === "weekly") d.setUTCDate(d.getUTCDate() + 7);
  else d.setUTCMonth(d.getUTCMonth() + 1);
  return d;
}

/** Enabled schedules whose next_run_at is due (<= now), earliest first. */
export async function dueSchedules(now: Date = new Date()): Promise<SurveyScheduleRow[]> {
  return db
    .select()
    .from(surveySchedulesTable)
    .where(
      and(
        eq(surveySchedulesTable.enabled, true),
        lte(surveySchedulesTable.nextRunAt, now),
      ),
    )
    .orderBy(asc(surveySchedulesTable.nextRunAt));
}

/**
 * Record that a schedule fired: stamp last_run, then either advance
 * next_run_at (recurring) or disable it (one-time).
 */
export async function markScheduleFired(
  schedule: SurveyScheduleRow,
  runId: number | null,
  firedAt: Date = new Date(),
): Promise<void> {
  if (schedule.mode === "recurring" && isCadence(schedule.cadence)) {
    // Advance from the scheduled time (not firedAt) so cadence doesn't drift.
    let next = advanceRecurring(schedule.cadence, schedule.nextRunAt);
    // If we're behind (e.g. cron missed days), catch up past now.
    while (next.getTime() <= firedAt.getTime()) {
      next = advanceRecurring(schedule.cadence, next);
    }
    await db
      .update(surveySchedulesTable)
      .set({ lastRunAt: firedAt, lastRunId: runId, nextRunAt: next })
      .where(eq(surveySchedulesTable.id, schedule.id));
  } else {
    await db
      .update(surveySchedulesTable)
      .set({ lastRunAt: firedAt, lastRunId: runId, enabled: false })
      .where(eq(surveySchedulesTable.id, schedule.id));
  }
}
