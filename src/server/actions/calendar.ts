"use server";

/**
 * Working-calendar mutations (spec §7). The client stages changes; `previewCalendarChange`
 * recomputes which work packages would move against the latest stored WBS ("14 activities will
 * move"), and `saveCalendar` recomputes the same list again and writes settings, the full date
 * list and the rescheduled end dates atomically through `save_calendar` (logged by DB triggers).
 */
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { fail, failFrom, fromZodError, ok, runAction, type ActionResult } from "@/lib/action-result";
import {
  calendarSettingsSchema,
  CalendarError,
  createCalendarIndex,
  formatDate,
  isValidISODate,
  rescheduleLeaves,
  type WorkingCalendar,
} from "@/lib/domain";
import type { Json } from "@/lib/supabase/database.types";
import { createClient, type ServerSupabaseClient } from "@/lib/supabase/server";
import { fetchActivities, planLockFor } from "@/server/queries/wbs";

const dateSchema = z.string().refine(isValidISODate, "Pick a valid date from the calendar.");

const draftSchema = z
  .object({
    projectId: z.uuid({ error: "Choose a valid project." }),
    settings: calendarSettingsSchema,
    holidays: z
      .array(
        z.object({
          date: dateSchema,
          name: z
            .string({ error: "Enter the holiday name." })
            .trim()
            .min(1, "Enter the holiday name, like Independence Day.")
            .max(200, "Use 200 characters or fewer for the holiday name."),
        }),
      )
      .max(1500, "A calendar can hold up to 1,500 holidays."),
    overrides: z
      .array(
        z.object({
          date: dateSchema,
          kind: z.enum(["working", "nonworking"]),
          note: z
            .string()
            .trim()
            .max(200, "Use 200 characters or fewer for the note.")
            .nullish()
            .transform((v) => (v ? v : null)),
        }),
      )
      .max(500, "A calendar can hold up to 500 overrides."),
  })
  .superRefine((value, ctx) => {
    const holidayDates = new Set<string>();
    value.holidays.forEach((h, i) => {
      if (holidayDates.has(h.date)) {
        ctx.addIssue({ code: "custom", path: ["holidays", i, "date"], message: `${formatDate(h.date)} is listed twice. Keep one holiday per date.` });
      }
      holidayDates.add(h.date);
    });
    const overrideDates = new Set<string>();
    value.overrides.forEach((o, i) => {
      if (overrideDates.has(o.date)) {
        ctx.addIssue({ code: "custom", path: ["overrides", i, "date"], message: `${formatDate(o.date)} has two overrides. Keep one.` });
      }
      overrideDates.add(o.date);
    });
  });

export type CalendarDraftInput = z.input<typeof draftSchema>;
type CalendarDraft = z.output<typeof draftSchema>;

export interface CalendarMove {
  id: string;
  wbsCode: string;
  name: string;
  startDate: string;
  previousEndDate: string | null;
  endDate: string;
}

function toWorkingCalendar(draft: CalendarDraft): WorkingCalendar {
  return {
    workDays: draft.settings.workDays,
    hoursPerDay: draft.settings.hoursPerDay,
    holidaysNonWorking: draft.settings.holidaysNonWorking,
    holidays: draft.holidays,
    overrides: draft.overrides,
  };
}

/** Work packages whose end date changes under the draft calendar (start and duration are kept). */
async function computeMoves(supabase: ServerSupabaseClient, draft: CalendarDraft): Promise<CalendarMove[]> {
  const activities = await fetchActivities(supabase, draft.projectId);
  const parents = new Set(activities.map((a) => a.parentId).filter((id): id is string => id !== null));
  const leaves = activities.filter(
    (a) => !parents.has(a.id) && a.startDate !== null && a.durationHours !== null,
  );
  const byId = new Map(activities.map((a) => [a.id, a]));
  const index = createCalendarIndex(toWorkingCalendar(draft));
  const changed = rescheduleLeaves(
    leaves.map((a) => ({
      id: a.id,
      startDate: a.startDate as string,
      durationHours: a.durationHours as number,
      endDate: a.endDate ?? "",
    })),
    index,
  );
  return changed
    .map((row) => {
      const activity = byId.get(row.id)!;
      return {
        id: row.id,
        wbsCode: activity.wbsCode,
        name: activity.name,
        startDate: row.startDate,
        previousEndDate: row.previousEndDate || null,
        endDate: row.endDate,
      };
    })
    .sort((a, b) => a.wbsCode.localeCompare(b.wbsCode, "en", { numeric: true }));
}

function calendarFailure(error: unknown) {
  if (error instanceof CalendarError && error.code === "NO_WORKING_DAYS") {
    return fail("NO_WORKING_DAYS", "This calendar has no working days. Choose at least one working day.", {
      "settings.workDays": "Choose at least one working day.",
    });
  }
  return null;
}

export async function previewCalendarChange(input: CalendarDraftInput): Promise<ActionResult<{ moves: CalendarMove[] }>> {
  return runAction(async () => {
    const parsed = draftSchema.safeParse(input);
    if (!parsed.success) return fromZodError(parsed.error);
    const supabase = await createClient();
    const lock = await planLockFor(supabase, parsed.data.projectId);
    if (lock) return fail(lock.code, lock.message);
    try {
      return ok({ moves: await computeMoves(supabase, parsed.data) });
    } catch (error) {
      const failure = calendarFailure(error);
      if (failure) return failure;
      throw error;
    }
  });
}

export interface SaveCalendarResult {
  rescheduled: number;
  datesAdded: number;
  datesRemoved: number;
  datesUpdated: number;
}

export async function saveCalendar(input: CalendarDraftInput): Promise<ActionResult<SaveCalendarResult>> {
  return runAction(async () => {
    const parsed = draftSchema.safeParse(input);
    if (!parsed.success) return fromZodError(parsed.error);
    const draft = parsed.data;
    const supabase = await createClient();
    const lock = await planLockFor(supabase, draft.projectId);
    if (lock) return fail(lock.code, lock.message);

    let moves: CalendarMove[];
    try {
      moves = await computeMoves(supabase, draft);
    } catch (error) {
      const failure = calendarFailure(error);
      if (failure) return failure;
      throw error;
    }

    const dates: Json[] = [
      ...draft.holidays.map((h) => ({ date: h.date, kind: "holiday", name: h.name })),
      ...draft.overrides.map((o) => ({
        date: o.date,
        kind: o.kind === "working" ? "override_working" : "override_nonworking",
        name: o.note,
      })),
    ];
    const schedule: Json[] = moves.map((m) => ({ id: m.id, end_date: m.endDate }));

    const { data, error } = await supabase.rpc("save_calendar", {
      p_project_id: draft.projectId,
      p_work_days: draft.settings.workDays,
      p_holidays_nonworking: draft.settings.holidaysNonWorking,
      p_hours_per_day: draft.settings.hoursPerDay,
      p_dates: dates,
      p_schedule: schedule,
    });
    if (error) return failFrom(error);
    const result = (data ?? {}) as {
      activities_rescheduled?: number;
      dates_added?: number;
      dates_removed?: number;
      dates_updated?: number;
    };

    revalidatePath(`/projects/${draft.projectId}`, "layout");
    return ok({
      rescheduled: result.activities_rescheduled ?? moves.length,
      datesAdded: result.dates_added ?? 0,
      datesRemoved: result.dates_removed ?? 0,
      datesUpdated: result.dates_updated ?? 0,
    });
  });
}
