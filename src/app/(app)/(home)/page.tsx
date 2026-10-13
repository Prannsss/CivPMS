import type { Metadata } from "next";
import { NoCompanyState } from "@/components/invitations/no-company-state";
import { ProjectsHome } from "@/components/projects/projects-home";
import { PageHeader } from "@/components/ui/page-header";
import { companyPermissions } from "@/lib/domain/permissions";
import { requireOnboarded } from "@/server/context";
import { getMyPendingInvitations } from "@/server/queries/invitations";
import { getHomeProjects, getProjectTrash, type TrashedProject } from "@/server/queries/projects";

export const metadata: Metadata = { title: "Projects" };

/**
 * Projects home (mockups 6–7, spec §4.2–4.3, §5.1–5.3). The top bar (company, greeting, bell,
 * palette) comes from the (home) layout; this page renders the content only.
 *
 * - No company yet (spec §4.3): pending invitations, the email to share and invite-code entry.
 * - Company members: the project grid (RLS decides which projects are visible), filters, the
 *   create dialog (`/?new=1`) and, for the Owner PM, "Recently deleted".
 */
export default async function HomePage() {
  // Start the RLS-scoped reads alongside the session check (one round trip fewer).
  const pending = getMyPendingInvitations();
  const visibleProjects = getHomeProjects();
  pending.catch(() => undefined);
  visibleProjects.catch(() => undefined);
  const context = await requireOnboarded();
  const email = context.profile.email ?? context.user.email ?? "";

  if (!context.membership) {
    const invitations = await pending;
    return (
      <>
        <PageHeader title="Projects" description="Join a company to see its projects." />
        <NoCompanyState email={email} invitations={invitations} />
      </>
    );
  }

  const { membership } = context;
  const permissions = companyPermissions(membership.role);
  const isOwner = membership.role === "owner_pm";
  const trashRequest: Promise<TrashedProject[] | null> = isOwner ? getProjectTrash() : Promise.resolve(null);
  const [invitations, projects, trash] = await Promise.all([pending, visibleProjects, trashRequest]);

  return (
    <ProjectsHome
      projects={projects}
      trash={trash}
      invitations={invitations}
      canCreate={permissions.canCreateProject}
      isOwner={isOwner}
      companyId={membership.companyId}
      companyName={membership.companyName}
      email={email}
      now={new Date().toISOString()}
    />
  );
}
