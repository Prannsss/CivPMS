import type { Metadata } from "next";
import Link from "next/link";
import { ChevronRight, FolderKanban, MapPin } from "lucide-react";
import { derivedBadgesFor, ProjectStatusBadges } from "@/components/app-shell/project-status-badges";
import { NoCompanyState } from "@/components/invitations/no-company-state";
import { PendingInvitations } from "@/components/invitations/pending-invitations";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { ProjectAvatar } from "@/components/ui/project-color";
import { pluralize } from "@/lib/domain/format";
import { requireOnboarded } from "@/server/context";
import { getMyPendingInvitations } from "@/server/queries/invitations";
import { getPaletteProjects } from "@/server/queries/palette";

export const metadata: Metadata = { title: "Projects" };

/**
 * Placeholder home: the projects team replaces the project list with the real home (mockups 6–7,
 * cards, filters, "+ Add project" on `/?new=1`). Pending invitations and the "No company yet"
 * state (spec §4.3) are real and come from components/invitations.
 */
export default async function HomePage() {
  const pending = getMyPendingInvitations();
  const visibleProjects = getPaletteProjects();
  pending.catch(() => undefined);
  visibleProjects.catch(() => undefined);
  const context = await requireOnboarded();
  const [invitations, projects] = await Promise.all([pending, visibleProjects]);
  const email = context.profile.email ?? context.user.email ?? "";

  if (!context.membership) {
    return (
      <>
        <PageHeader title="Projects" description="Join a company to see its projects." />
        <NoCompanyState email={email} invitations={invitations} />
      </>
    );
  }

  const attention = projects.filter((p) => p.isDelayed || p.budgetState !== "ok").length;
  const isInspector = context.membership.role === "inspector";

  return (
    <>
      <PageHeader
        title="Projects"
        description={
          projects.length === 0
            ? context.membership.companyName
            : `${pluralize(projects.length, "project")}${attention > 0 ? ` · ${attention} need${attention === 1 ? "s" : ""} attention` : ""}`
        }
      />
      <div className="flex flex-col gap-8">
        <PendingInvitations
          invitations={invitations}
          currentCompanyId={context.membership.companyId}
          currentCompanyName={context.membership.companyName}
          description="Accept to open the project."
        />

        {projects.length === 0 ? (
          <EmptyState
            icon={<FolderKanban />}
            title={isInspector ? "You haven't been added to a project yet" : "No projects yet"}
            description={
              isInspector
                ? `Ask your Project Manager to add you to a project. They can invite ${email}.`
                : "Projects you create or are added to show up here. Creating projects arrives with the new projects home."
            }
          />
        ) : (
          <section aria-labelledby="projects-list-heading" className="flex flex-col gap-3">
            <h2 id="projects-list-heading" className="sr-only">
              Your projects
            </h2>
            <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-surface shadow-xs">
              {projects.map((project) => (
                <li key={project.id}>
                  <Link
                    href={`/projects/${project.id}`}
                    className="group flex items-center gap-4 px-4 py-3.5 transition-colors hover:bg-surface-muted focus-ring-inset sm:px-5"
                  >
                    <ProjectAvatar name={project.name} color={project.color} size="md" />
                    <span className="flex min-w-0 flex-1 flex-col gap-1">
                      <span className="line-clamp-2 text-[15px] leading-6 font-semibold text-foreground sm:line-clamp-1">
                        {project.name}
                      </span>
                      {project.siteName ? (
                        <span className="flex items-center gap-1 text-[13px] leading-5 text-muted-foreground">
                          <MapPin aria-hidden className="size-3.5 shrink-0" />
                          <span className="truncate">{project.siteName}</span>
                        </span>
                      ) : null}
                      <span className="flex flex-wrap gap-1.5 sm:hidden">
                        <ProjectStatusBadges status={project.status} derived={derivedBadgesFor(projectFlags(project))} size="sm" />
                      </span>
                    </span>
                    <span className="hidden flex-wrap justify-end gap-1.5 sm:flex">
                      <ProjectStatusBadges status={project.status} derived={derivedBadgesFor(projectFlags(project))} size="sm" />
                    </span>
                    <ChevronRight
                      aria-hidden
                      className="size-5 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5"
                    />
                  </Link>
                </li>
              ))}
            </ul>
            <p className="text-caption text-muted-foreground">
              Project cards with progress, budget and filters are coming to this page.
            </p>
          </section>
        )}
      </div>
    </>
  );
}

function projectFlags(project: { isDelayed: boolean; budgetState: string }) {
  return { is_delayed: project.isDelayed, budget_state: project.budgetState };
}
