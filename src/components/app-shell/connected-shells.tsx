import "server-only";

import type { ProjectAccess } from "@/server/context";
import { HomeShellClient } from "./home-shell-client";
import { loadShellData } from "./load-shell-data";
import { derivedBadgesFor } from "./project-status-badges";
import { ProjectShellClient, type ShellProject } from "./project-shell-client";

/**
 * Home frame (top bar only): loads the signed-in user, company, notifications and visible
 * projects on the server, then hands them to the client shell (Realtime, palette, menus).
 */
export async function ConnectedHomeShell({ children }: { children: React.ReactNode }) {
  const data = await loadShellData();
  return <HomeShellClient data={data}>{children}</HomeShellClient>;
}

/** Project frame (sidebar + top bar) for a project the caller can see. */
export async function ConnectedProjectShell({
  access,
  children,
}: {
  access: ProjectAccess;
  children: React.ReactNode;
}) {
  const data = await loadShellData();
  const { project, permissions } = access;
  const shellProject: ShellProject = {
    id: project.id,
    name: project.name,
    color: project.color,
    status: project.status,
    siteName: project.site_name,
    derivedBadges: derivedBadgesFor(project),
    canManage: permissions.canEditProject,
  };
  return (
    <ProjectShellClient data={data} project={shellProject}>
      {children}
    </ProjectShellClient>
  );
}
