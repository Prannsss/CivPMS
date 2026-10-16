import type { Metadata } from "next";
import Link from "next/link";
import { Lock } from "lucide-react";
import { StatusPanel as StatusPage } from "@/components/app-shell/status-page";
import { DangerZone } from "@/components/project-settings/danger-zone";
import { ProjectDetailsForm } from "@/components/project-settings/project-details-form";
import { SettingsSection } from "@/components/project-settings/settings-section";
import { StatusPanel } from "@/components/project-settings/status-panel";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { getProjectAccess } from "@/server/context";
import { getCollaborators } from "@/server/queries/collaborators";
import { getWorkSummary } from "@/server/queries/project-dashboard";

export const metadata: Metadata = { title: "Project Settings" };

/** Project Settings (spec §5): details, status, archive and delete. Managers only. */
export default async function ProjectSettingsPage({ params }: PageProps<"/projects/[projectId]/settings">) {
  const { projectId } = await params;
  const { project, permissions, companyRole, projectRole } = await getProjectAccess(projectId);

  if (!permissions.canEditProject) {
    return (
      <div className="flex min-h-[60dvh] items-center justify-center py-12">
        <StatusPage
          eyebrow="Managers only"
          icon={<Lock />}
          title="You can't change this project's settings"
          description="Only the project's Project Managers and the Owner PM can edit its details, status and budget. Ask one of them if something needs to change."
          actions={
            <Button variant="outline" asChild>
              <Link href={`/projects/${project.id}`}>Back to dashboard</Link>
            </Button>
          }
        />
      </div>
    );
  }

  const [work, collaborators] = await Promise.all([
    getWorkSummary(project.id, project.weighting),
    permissions.canDelete ? getCollaborators(project.id, project.company_id) : Promise.resolve([]),
  ]);

  return (
    <div className="flex flex-col gap-8 lg:gap-10">
      <PageHeader
        className="pb-0 sm:pb-0"
        title="Project Settings"
        description="Details, budget, status and the project's lifecycle. Every change is recorded in the audit trail."
      />

      <SettingsSection
        id="details"
        title="Details"
        description="Name, dates, budget and site. Dates and budget drive the Delayed and budget badges."
      >
        <ProjectDetailsForm
          projectId={project.id}
          initialVersion={project.version}
          initial={{
            name: project.name,
            startDate: project.start_date,
            endDate: project.end_date,
            budget: Number(project.budget),
            siteName: project.site_name ?? "",
            siteAddress: project.site_address ?? "",
            description: project.description ?? "",
            color: project.color,
            weighting: project.weighting,
            nearBudgetThreshold: Number(project.near_budget_threshold),
          }}
        />
      </SettingsSection>

      <SettingsSection
        id="status"
        title="Status"
        description="Planning → Active → On-Hold → Completed, or Cancelled. Status changes notify everyone on the project."
      >
        <StatusPanel
          projectId={project.id}
          projectName={project.name}
          status={project.status}
          statusReason={project.status_reason}
          isArchived={project.is_archived}
          companyRole={companyRole}
          projectRole={projectRole}
          activityCount={work.activityCount}
          incompleteCount={work.incompleteCount}
          incomplete={work.incomplete}
          canArchive={permissions.canArchive}
        />
      </SettingsSection>

      {permissions.canDelete ? (
        <SettingsSection
          id="danger"
          title="Danger zone"
          tone="danger"
          description="Only the Owner PM can delete a project."
        >
          <DangerZone
            projectId={project.id}
            projectName={project.name}
            activityCount={work.activityCount}
            memberCount={collaborators.filter((member) => !member.isOwner).length}
          />
        </SettingsSection>
      ) : null}
    </div>
  );
}
