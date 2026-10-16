import type { Metadata } from "next";
import { Lock } from "lucide-react";
import { auditFiltersToSearchParams, encodeAuditCursor, hasActiveFilters, parseAuditFilters } from "@/components/audit/audit-filters";
import { AuditFiltersBar } from "@/components/audit/audit-filters-bar";
import { AuditLog } from "@/components/audit/audit-log";
import { PageHeader } from "@/components/ui/page-header";
import { todayInManila } from "@/lib/domain/dates";
import { getProjectAccess } from "@/server/context";
import { getAuditActors, getAuditPage } from "@/server/queries/audit";

export const metadata: Metadata = { title: "Audit Trail" };

/** Audit Trail (spec §10.6): the project's append-only history with filters, paging and CSV export. */
export default async function AuditPage({ params, searchParams }: PageProps<"/projects/[projectId]/audit">) {
  const { projectId } = await params;
  const filters = parseAuditFilters(await searchParams);
  const { project, permissions } = await getProjectAccess(projectId);
  const [page, actors] = await Promise.all([getAuditPage(project.id, filters), getAuditActors(project.id)]);

  const query = auditFiltersToSearchParams(filters).toString();
  const basePath = `/projects/${project.id}/audit`;
  const exportHref = `${basePath}/export${query ? `?${query}` : ""}`;

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        className="pb-1 sm:pb-1"
        title="Audit Trail"
        description={
          <span className="inline-flex flex-wrap items-center gap-x-1.5">
            Every change to this project, who made it and when (Philippine time).
            <span className="inline-flex items-center gap-1 whitespace-nowrap">
              <Lock aria-hidden className="size-3.5" />
              Entries can&rsquo;t be edited or deleted.
            </span>
          </span>
        }
      />
      <AuditFiltersBar filters={filters} actors={actors} exportHref={exportHref} canExport={permissions.canExport} />
      <AuditLog
        key={query}
        projectId={project.id}
        query={query}
        initialEntries={page.entries}
        initialCursor={page.nextCursor ? encodeAuditCursor(page.nextCursor) : null}
        total={page.total}
        today={todayInManila()}
        now={new Date().toISOString()}
        filtered={hasActiveFilters(filters)}
        onClearHref={basePath}
      />
    </div>
  );
}
