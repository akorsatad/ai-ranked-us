import { and, asc, eq, isNull, lte } from "drizzle-orm";
import {
  db,
  surveySchedulesTable,
  industriesTable,
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

/** Next occurrence of RUN_HOUR_UTC on the given UTC weekday (0=Sun), after now. */
function nextWeekly(weekday: number, from: Date = new Date()): Date {
  const d = nextDailyRun(from);
  while (d.getUTCDay() !== weekday) d.setUTCDate(d.getUTCDate() + 1);
  return d;
}

/**
 * Split the survey into per-industry schedules on a cadence that matches cost:
 * a DAILY "current" (ranking) schedule per industry, plus a WEEKLY "trend"
 * (13-week lookback) schedule per industry. Full runs are expensive and stall,
 * so any full-scope recurring schedule is disabled. next_run_at is staggered so
 * a frequent cron picks runs up spread across the window. Idempotent —
 * dedupes on (industryId, queryScope).
 */
export async function ensurePerIndustrySchedules(
  staggerMinutes = 15,
): Promise<{ created: number; disabledFullRuns: number }> {
  // Retire full-scope / "both" recurring schedules — they're what stalls.
  const disabled = await db
    .update(surveySchedulesTable)
    .set({ enabled: false })
    .where(
      and(
        eq(surveySchedulesTable.mode, "recurring"),
        eq(surveySchedulesTable.enabled, true),
        isNull(surveySchedulesTable.industryId),
      ),
    )
    .returning({ id: surveySchedulesTable.id });

  const industries = (await db.select().from(industriesTable)).filter(
    (i) => i.enabled,
  );
  const existing = await db
    .select()
    .from(surveySchedulesTable)
    .where(eq(surveySchedulesTable.mode, "recurring"));
  const have = new Set(
    existing
      .filter((s) => s.enabled && s.industryId != null)
      .map((s) => `${s.industryId}:${s.queryScope}`),
  );

  const dailyBase = nextDailyRun();
  const weeklyBase = nextWeekly(0); // Sundays 06:00 UTC for the 13-week lookback
  let created = 0;
  let i = 0;
  for (const industry of industries) {
    // Daily current-ranking schedule.
    if (!have.has(`${industry.id}:current`)) {
      await db.insert(surveySchedulesTable).values({
        mode: "recurring",
        cadence: "daily",
        queryScope: "current",
        industryId: industry.id,
        enabled: true,
        nextRunAt: new Date(dailyBase.getTime() + i * staggerMinutes * 60_000),
      });
      created++;
    }
    // Weekly 13-week-lookback schedule.
    if (!have.has(`${industry.id}:trend`)) {
      await db.insert(surveySchedulesTable).values({
        mode: "recurring",
        cadence: "weekly",
        queryScope: "trend",
        industryId: industry.id,
        enabled: true,
        nextRunAt: new Date(weeklyBase.getTime() + i * staggerMinutes * 60_000),
      });
      created++;
    }
    i++;
  }
  return { created, disabledFullRuns: disabled.length };
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
