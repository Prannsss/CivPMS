import type { Metadata } from "next";
import { GanttView } from "@/components/gantt/gantt-view";
import { todayInManila, type BaselineDates, type DurationUnit } from "@/lib/domain";
import { getProjectAccess, getSessionContext } from "@/server/context";
import { getBaselineActivities, getBaselines } from "@/server/queries/baselines";
import { getProjectCalendar } from "@/server/queries/calendar";
import { getWbsActivities } from "@/server/queries/wbs";

export const metadata: Metadata = { title: "Gantt Chart" };

/**
 * Gantt chart (spec §9.1, §5.4), read-only Stage A (docs/ROADMAP.md §4.0): bars from the WBS and the
 * working calendar, with an optional baseline overlay (`?baseline=<id>`, default the active one).
 */
export default async function GanttPage({ params, searchParams }: PageProps<"/projects/[projectId]/gantt">) {
  const { projectId } = await params;
  const { baseline: baselineParam } = await searchParams;
  const { project, permissions } = await getProjectAccess(projectId);

  const [session, activities, calendar, baselines] = await Promise.all([
    getSessionContext(),
    getWbsActivities(projectId),
    getProjectCalendar(projectId),
    getBaselines(projectId),
  ]);

  const requested = typeof baselineParam === "string" ? baselines.find((b) => b.id === baselineParam) : undefined;
  const shown = requested ?? baselines.find((b) => b.isActive) ?? baselines[0] ?? null;
  const baselineRows = shown ? await getBaselineActivities(projectId, shown.id) : [];
  const baselineDates: Record<string, BaselineDates> = {};
  for (const row of baselineRows) {
    if (row.activityId) baselineDates[row.activityId] = { start: row.startDate, end: row.endDate };
  }

  const durationUnit: DurationUnit = session.profile?.duration_unit === "days" ? "days" : "hours";

  return (
    <GanttView
      project={{
        id: project.id,
        status: project.status,
        startDate: project.start_date,
        endDate: project.end_date,
        weighting: project.weighting,
      }}
      activities={activities}
      calendar={calendar}
      baselines={baselines.map((b) => ({ id: b.id, version: b.version, reason: b.reason, isActive: b.isActive }))}
      baselineId={shown?.id ?? null}
      baselineDates={baselineDates}
      today={todayInManila()}
      durationUnit={durationUnit}
      canEditWbs={permissions.canEditWbs}
    />
  );
}
