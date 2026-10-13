import type { Metadata } from "next";
import Link from "next/link";
import { LayoutDashboard, ListTree } from "lucide-react";
import { derivedBadgesFor, ProjectStatusBadges } from "@/components/app-shell/project-status-badges";
import { ScreenPlaceholder } from "@/components/app-shell/screen-placeholder";
import { Button } from "@/components/ui/button";
import { formatDateRange } from "@/lib/domain/format";
import { getProjectAccess } from "@/server/context";

export const metadata: Metadata = { title: "Dashboard" };

/** Placeholder: the dashboard team replaces this page (spec §9.4). */
export default async function ProjectDashboardPage({ params }: PageProps<"/projects/[projectId]">) {
  const { projectId } = await params;
  const { project } = await getProjectAccess(projectId);
  return (
    <ScreenPlaceholder
      title="Dashboard"
      description={
        <>
          {project.site_name ? <>{project.site_name} · </> : null}
          <span className="whitespace-nowrap tabular-nums">{formatDateRange(project.start_date, project.end_date)}</span>
        </>
      }
      meta={<ProjectStatusBadges status={project.status} derived={derivedBadgesFor(project)} />}
      icon={<LayoutDashboard />}
      upcoming="Overall progress, the budget meter, delayed activities and everything that needs attention, at a glance."
      action={
        <Button asChild>
          <Link href={`/projects/${project.id}/wbs`}>
            <ListTree aria-hidden />
            Open Work Breakdown
          </Link>
        </Button>
      }
    />
  );
}
