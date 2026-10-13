import type { Metadata } from "next";
import Link from "next/link";
import { Lock, Settings } from "lucide-react";
import { ScreenPlaceholder } from "@/components/app-shell/screen-placeholder";
import { StatusPanel } from "@/components/app-shell/status-page";
import { Button } from "@/components/ui/button";
import { getProjectAccess } from "@/server/context";

export const metadata: Metadata = { title: "Project Settings" };

/** Placeholder: the project-settings team replaces this page (spec §5). Managers only. */
export default async function ProjectSettingsPage({ params }: PageProps<"/projects/[projectId]/settings">) {
  const { projectId } = await params;
  const { project, permissions } = await getProjectAccess(projectId);

  if (!permissions.canEditProject) {
    return (
      <div className="flex min-h-[60dvh] items-center justify-center py-12">
        <StatusPanel
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

  return (
    <ScreenPlaceholder
      title="Project Settings"
      description="Details, status, budget and appearance"
      icon={<Settings />}
      upcoming="Edit the name, site, dates, budget and color, change the status, and archive or delete the project."
    />
  );
}
