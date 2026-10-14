import type { Metadata } from "next";
import { WbsWorkspace } from "@/components/wbs/wbs-workspace";
import type { WbsLockReason } from "@/components/wbs/types";
import { todayInManila, type DurationUnit } from "@/lib/domain";
import { getSessionContext, getProjectAccess } from "@/server/context";
import { getProjectCalendar } from "@/server/queries/calendar";
import { getActivityTrash, getWbsActivities } from "@/server/queries/wbs";

export const metadata: Metadata = { title: "Work Breakdown" };

/** Work breakdown structure (spec §6, §9.3): list + graph views, inline edits for managers. */
export default async function WbsPage({ params }: PageProps<"/projects/[projectId]/wbs">) {
  const { projectId } = await params;
  const { project, permissions } = await getProjectAccess(projectId);
  const canEdit = permissions.canEditWbs;

  const [session, activities, calendar, trash] = await Promise.all([
    getSessionContext(),
    getWbsActivities(projectId),
    getProjectCalendar(projectId),
    canEdit ? getActivityTrash(projectId) : Promise.resolve([]),
  ]);

  // The database allows WBS edits on closed projects, so the UI guards them (CLAUDE.md pitfalls).
  const lockReason: WbsLockReason = !canEdit
    ? "role"
    : project.status === "completed"
      ? "completed"
      : project.status === "cancelled"
        ? "cancelled"
        : null;

  const durationUnit: DurationUnit = session.profile?.duration_unit === "days" ? "days" : "hours";

  return (
    <WbsWorkspace
      project={{
        id: project.id,
        name: project.name,
        budget: Number(project.budget),
        startDate: project.start_date,
        endDate: project.end_date,
        status: project.status,
        weighting: project.weighting,
        nearBudgetThreshold: Number(project.near_budget_threshold),
      }}
      activities={activities}
      trash={trash}
      calendar={calendar}
      durationUnit={durationUnit}
      today={todayInManila()}
      lockReason={lockReason}
      isManager={canEdit}
    />
  );
}
