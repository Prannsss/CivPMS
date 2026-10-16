import type { Metadata } from "next";
import { ConnectedProjectShell } from "@/components/app-shell/connected-shells";
import { APP_NAME } from "@/lib/constants";
import { getProjectAccess } from "@/server/context";

export async function generateMetadata({ params }: LayoutProps<"/projects/[projectId]">): Promise<Metadata> {
  const { projectId } = await params;
  const { project } = await getProjectAccess(projectId);
  return { title: { absolute: `${project.name} · ${APP_NAME}`, template: `%s · ${project.name} · ${APP_NAME}` } };
}

/**
 * Project workspace (mockup 8): sidebar + top bar. `getProjectAccess` 404s for projects that
 * don't exist or aren't visible to the caller (RLS), which renders projects/not-found.tsx.
 */
export default async function ProjectLayout({ children, params }: LayoutProps<"/projects/[projectId]">) {
  const { projectId } = await params;
  const access = await getProjectAccess(projectId);
  return <ConnectedProjectShell access={access}>{children}</ConnectedProjectShell>;
}
