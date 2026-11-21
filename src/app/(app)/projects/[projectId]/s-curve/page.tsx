import type { Metadata } from "next";
import { SCurveView } from "@/components/scurve/scurve-view";
import { todayInManila, type DurationUnit } from "@/lib/domain";
import { getProjectAccess, getSessionContext } from "@/server/context";
import { getBaselineActivities, getBaselines } from "@/server/queries/baselines";
import { getProjectCalendar } from "@/server/queries/calendar";
import { getWbsActivities } from "@/server/queries/wbs";

export const metadata: Metadata = { title: "S-Curve" };

/**
 * S-curve (spec §9.2), Stage A (docs/ROADMAP.md §4.0): the planned line from a baseline
 * (`?baseline=<id>`, default the active one). The actual line arrives with progress updates.
 */
export default async function SCurvePage({ params, searchParams }: PageProps<"/projects/[projectId]/s-curve">) {
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
  const rows = shown ? await getBaselineActivities(projectId, shown.id) : [];
  const leaves = rows.filter((r) => r.isLeaf);

  // Current work packages (no children) that the shown baseline does not contain.
  const parentIds = new Set(activities.map((a) => a.parentId).filter((id): id is string => id !== null));
  const inBaseline = new Set(rows.map((r) => r.activityId));
  const notInBaseline = shown ? activities.filter((a) => !parentIds.has(a.id) && !inBaseline.has(a.id)).length : 0;

  const durationUnit: DurationUnit = session.profile?.duration_unit === "days" ? "days" : "hours";

  return (
    <SCurveView
      project={{
        id: project.id,
        status: project.status,
        startDate: project.start_date,
        endDate: project.end_date,
        weighting: project.weighting,
      }}
      baselines={baselines.map((b) => ({ id: b.id, version: b.version, isActive: b.isActive }))}
      baselineId={shown?.id ?? null}
      baselineLeaves={leaves.map((l) => ({ start: l.startDate, end: l.endDate, cost: l.cost, hours: l.hours }))}
      calendar={calendar}
      today={todayInManila()}
      durationUnit={durationUnit}
      notInBaseline={notInBaseline}
      canEditProject={permissions.canEditProject}
    />
  );
}
