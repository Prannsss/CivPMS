"use client";

import { useEffect, useMemo } from "react";
import { ProjectShell } from "@/components/shell/project-shell";
import { getProjectNavItems } from "@/components/shell/project-sidebar";
import type { DerivedBadge, ProjectStatus } from "@/components/ui/status-badge";
import { RealtimeStatus } from "./realtime-status";
import { ProjectBreadcrumb } from "./shell-leading";
import type { ShellData } from "./types";
import { SIGN_OUT_PATH, useConnectedShell } from "./use-connected-shell";

export type ShellProject = {
  id: string;
  name: string;
  color: string;
  status: ProjectStatus;
  siteName: string | null;
  derivedBadges: DerivedBadge[];
  /** Owner PM or a PM on this project: shows Project Settings (UI only; the DB enforces access). */
  canManage: boolean;
};

export type ProjectShellClientProps = {
  data: ShellData;
  project: ShellProject;
  /** Desktop rail collapsed (from the cookie). */
  sidebarCollapsed?: boolean;
  children: React.ReactNode;
};

/** Sidebar frame for /projects/[projectId]/*, wired to live data (mockup 8). */
export function ProjectShellClient({ data, project, sidebarCollapsed = false, children }: ProjectShellClientProps) {
  const navItems = useMemo(
    () => getProjectNavItems(project.id).filter((item) => item.id !== "settings" || project.canManage),
    [project.id, project.canManage],
  );
  const shell = useConnectedShell(data, {
    projectId: project.id,
    projectName: project.name,
    navItems,
  });
  const { rememberRecent } = shell;

  // Opening a project puts it at the top of the palette's "Recent" list.
  useEffect(() => {
    rememberRecent({
      id: `project:${project.id}`,
      label: project.name,
      hint: project.siteName ?? undefined,
      href: `/projects/${project.id}`,
      kind: "project",
      color: project.color,
    });
  }, [rememberRecent, project.id, project.name, project.siteName, project.color]);

  return (
    <>
      <ProjectShell
        initialCollapsed={sidebarCollapsed}
        sidebar={{
          project: {
            name: project.name,
            color: project.color,
            status: project.status,
            derivedBadges: project.derivedBadges,
          },
          items: navItems,
          allProjectsHref: "/",
          signOut: { action: SIGN_OUT_PATH },
        }}
        topBar={{
          leading: <ProjectBreadcrumb name={project.name} color={project.color} />,
          notifications: shell.notifications,
          user: shell.user,
          searchPlaceholder: shell.searchPlaceholder,
        }}
        palette={shell.palette}
      >
        {children}
      </ProjectShell>
      <RealtimeStatus live={shell.live} />
    </>
  );
}
