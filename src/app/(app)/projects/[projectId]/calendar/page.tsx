import type { Metadata } from "next";
import { CalendarWorkspace, type CalendarLockReason } from "@/components/calendar/calendar-workspace";
import { todayInManila } from "@/lib/domain";
import { getProjectAccess } from "@/server/context";
import { getProjectCalendar } from "@/server/queries/calendar";

export const metadata: Metadata = { title: "Calendar" };

/** The project's working calendar (spec §7): working days, hours per day, holidays and overrides. */
export default async function CalendarPage({ params }: PageProps<"/projects/[projectId]/calendar">) {
  const { projectId } = await params;
  const { project, permissions } = await getProjectAccess(projectId);
  const calendar = await getProjectCalendar(projectId);

  const lockReason: CalendarLockReason = !permissions.canEditCalendar
    ? "role"
    : project.status === "completed"
      ? "completed"
      : project.status === "cancelled"
        ? "cancelled"
        : null;

  return (
    <CalendarWorkspace
      projectId={project.id}
      projectStart={project.start_date}
      projectEnd={project.end_date}
      calendar={calendar}
      today={todayInManila()}
      lockReason={lockReason}
    />
  );
}
