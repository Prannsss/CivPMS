import type { Metadata } from "next";
import { ListTree } from "lucide-react";
import { ScreenPlaceholder } from "@/components/app-shell/screen-placeholder";
import { pluralize } from "@/lib/domain/format";
import { getProjectAccess } from "@/server/context";

export const metadata: Metadata = { title: "Work Breakdown" };

/** Placeholder: the WBS team replaces this page (spec §6, §9.3). */
export default async function WbsPage({ params }: PageProps<"/projects/[projectId]/wbs">) {
  const { projectId } = await params;
  const { project } = await getProjectAccess(projectId);
  return (
    <ScreenPlaceholder
      title="Work Breakdown"
      description={`${pluralize(project.activity_count, "activity", "activities")} · ${pluralize(project.leaf_count, "work package")}`}
      icon={<ListTree />}
      upcoming="Deliverables, sub-deliverables and work packages as a list or a graph, with dates, hours and costs. Parents roll up from their work packages."
    />
  );
}
