import type { Metadata } from "next";
import { CalendarDays } from "lucide-react";
import { ScreenPlaceholder } from "@/components/app-shell/screen-placeholder";
import { getProjectAccess } from "@/server/context";

export const metadata: Metadata = { title: "Calendar" };

/** Placeholder: the calendar team replaces this page (spec §7). */
export default async function CalendarPage({ params }: PageProps<"/projects/[projectId]/calendar">) {
  const { projectId } = await params;
  await getProjectAccess(projectId);
  return (
    <ScreenPlaceholder
      title="Calendar"
      description="Working days, hours per day and holidays"
      icon={<CalendarDays />}
      upcoming="Set working days and hours, mark Philippine holidays and site exceptions. Changes preview which work packages move before anything is saved."
    />
  );
}
