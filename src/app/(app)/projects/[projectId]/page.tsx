import type { Metadata } from "next";
import Link from "next/link";
import { ListTree, MapPin } from "lucide-react";
import { derivedBadgesFor, ProjectStatusBadges } from "@/components/app-shell/project-status-badges";
import { buildAttentionItems } from "@/components/project-dashboard/attention";
import {
  AttentionCard,
  BudgetCard,
  DashboardKpis,
  InspectionsComingCard,
  OverdueBanner,
  RecentActivityCard,
  ScheduleCard,
  type DashboardProject,
} from "@/components/project-dashboard/dashboard-cards";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { formatDateRange } from "@/lib/domain/format";
import { getProjectAccess } from "@/server/context";
import { getRecentProjectActivity } from "@/server/queries/audit";
import { getWorkSummary } from "@/server/queries/project-dashboard";

export const metadata: Metadata = { title: "Dashboard" };

/** Project dashboard (spec §9.4, Phase 1): status, progress, budget, schedule and what needs attention. */
export default async function ProjectDashboardPage({ params }: PageProps<"/projects/[projectId]">) {
  const { projectId } = await params;
  const { project, permissions } = await getProjectAccess(projectId);
  const [work, recent] = await Promise.all([
    getWorkSummary(project.id, project.weighting),
    getRecentProjectActivity(project.id, 8),
  ]);
  const now = new Date().toISOString();

  const dashboardProject: DashboardProject = {
    id: project.id,
    name: project.name,
    status: project.status,
    startDate: project.start_date,
    endDate: project.end_date,
    budget: Number(project.budget),
    allocated: Number(project.allocated),
    nearBudgetThreshold: Number(project.near_budget_threshold),
    isDelayed: project.is_delayed,
    budgetState: project.budget_state,
  };
  // The overdue banner already says the project is late (§5.4); the list starts with what follows from it.
  const attention = buildAttentionItems({
    project: dashboardProject,
    work,
    canManage: permissions.canEditProject,
  }).filter((item) => item.kind !== "project_overdue");

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        className="pb-0 sm:pb-0"
        title="Dashboard"
        // The top bar shows the full project name on desktop; phones truncate it there, so repeat it here.
        breadcrumbs={<span className="font-medium text-foreground lg:hidden">{project.name}</span>}
        meta={
          <>
            <ProjectStatusBadges status={project.status} derived={derivedBadgesFor(project)} />
            {project.is_archived ? (
              <Badge tone="neutral" variant="outline">
                Archived
              </Badge>
            ) : null}
          </>
        }
        description={
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            {project.site_name ? (
              <span className="inline-flex min-w-0 items-center gap-1.5">
                <MapPin aria-hidden className="size-4 shrink-0" />
                <span className="break-words">{project.site_name}</span>
              </span>
            ) : null}
            <span className="whitespace-nowrap tabular-nums">{formatDateRange(project.start_date, project.end_date)}</span>
          </span>
        }
        actions={
          <Button variant={permissions.canEditWbs ? "primary" : "outline"} asChild className="w-full sm:w-auto">
            <Link href={`/projects/${project.id}/wbs`}>
              <ListTree aria-hidden />
              Open work breakdown
            </Link>
          </Button>
        }
      />

      <OverdueBanner
        project={dashboardProject}
        today={work.today}
        scheduleEnd={work.scheduleEnd}
        canManage={permissions.canEditProject}
      />

      <DashboardKpis project={dashboardProject} work={work} />

      {/* Below lg the column wrappers are `contents`, so `order-*` puts Budget and Schedule right after "Needs attention". */}
      <div className="flex flex-col gap-4 lg:grid lg:grid-cols-3 lg:items-start">
        <div className="contents lg:col-span-2 lg:flex lg:min-w-0 lg:flex-col lg:gap-4">
          <div className="order-1 min-w-0">
            <AttentionCard items={attention} projectId={project.id} />
          </div>
          <div className="order-4 min-w-0">
            <RecentActivityCard entries={recent} projectId={project.id} now={now} />
          </div>
        </div>
        <div className="contents lg:flex lg:min-w-0 lg:flex-col lg:gap-4">
          <div className="order-2 min-w-0">
            <BudgetCard project={dashboardProject} />
          </div>
          <div className="order-3 min-w-0">
            <ScheduleCard project={dashboardProject} work={work} />
          </div>
          <div className="order-5 min-w-0">
            <InspectionsComingCard />
          </div>
        </div>
      </div>
    </div>
  );
}
