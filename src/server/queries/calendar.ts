import "server-only";

/**
 * The project's working calendar (spec §7): settings from `calendars`, holidays and per-date
 * overrides from `calendar_dates`. RLS limits both to people who can view the project.
 *
 * `fetchWorkingCalendar(supabase, projectId)` is reused by the WBS and calendar Server Actions so
 * the authoritative end-date recompute (D20) always runs against the stored calendar.
 */
import { cache } from "react";
import {
  DEFAULT_WORKING_CALENDAR,
  type CalendarHoliday,
  type CalendarOverride,
  type WorkingCalendar,
} from "@/lib/domain";
import { AppException, toAppError } from "@/lib/errors";
import { createClient, type ServerSupabaseClient } from "@/lib/supabase/server";

export interface CalendarOverrideEntry extends CalendarOverride {
  note: string | null;
}

export interface ProjectCalendar extends WorkingCalendar {
  overrides: CalendarOverrideEntry[];
}

function throwRead(error: unknown): never {
  const appError = toAppError(error);
  throw new AppException(appError.code, appError.message, { cause: error });
}

/** Reads settings + dates and maps them to the domain `WorkingCalendar`. Throws AppException on failure. */
export async function fetchWorkingCalendar(
  supabase: ServerSupabaseClient,
  projectId: string,
): Promise<ProjectCalendar> {
  const [settingsResult, datesResult] = await Promise.all([
    supabase
      .from("calendars")
      .select("work_days, hours_per_day, holidays_nonworking")
      .eq("project_id", projectId)
      .maybeSingle(),
    supabase
      .from("calendar_dates")
      .select("date, kind, name")
      .eq("project_id", projectId)
      .order("date", { ascending: true })
      .limit(5000),
  ]);
  if (settingsResult.error) throwRead(settingsResult.error);
  if (datesResult.error) throwRead(datesResult.error);

  const settings = settingsResult.data;
  const holidays: CalendarHoliday[] = [];
  const overrides: CalendarOverrideEntry[] = [];
  for (const row of datesResult.data ?? []) {
    if (row.kind === "holiday") {
      holidays.push({ date: row.date, name: row.name?.trim() || "Holiday" });
    } else {
      overrides.push({
        date: row.date,
        kind: row.kind === "override_working" ? "working" : "nonworking",
        note: row.name?.trim() || null,
      });
    }
  }

  return {
    workDays: settings ? [...settings.work_days].sort((a, b) => a - b) : [...DEFAULT_WORKING_CALENDAR.workDays],
    hoursPerDay: settings ? Number(settings.hours_per_day) : DEFAULT_WORKING_CALENDAR.hoursPerDay,
    holidaysNonWorking: settings ? settings.holidays_nonworking : DEFAULT_WORKING_CALENDAR.holidaysNonWorking,
    holidays,
    overrides,
  };
}

/** Request-memoised calendar for Server Components. */
export const getProjectCalendar = cache(async (projectId: string): Promise<ProjectCalendar> => {
  const supabase = await createClient();
  return fetchWorkingCalendar(supabase, projectId);
});
