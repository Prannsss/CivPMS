/**
 * GET /projects/<id>/audit/export?<filters> — the Audit Trail as CSV (spec §10.6, §16.1).
 * Same filters as the page, read as the signed-in user (RLS), so people only export what they can
 * see. Inspectors may export (A4). Capped at 20,000 rows per file.
 */
import { NextResponse, type NextRequest } from "next/server";
import { describeAuditFilters, parseAuditFilters, SYSTEM_ACTOR } from "@/components/audit/audit-filters";
import { auditCsvFilename, buildAuditCsv } from "@/components/audit/audit-csv";
import { projectPermissions, todayInManila } from "@/lib/domain";
import { toAppError } from "@/lib/errors";
import { createClient } from "@/lib/supabase/server";
import { isUuid } from "@/server/context";
import { fetchAuditEntries, type AuditEntry } from "@/server/queries/audit";
import type { AuditCursor } from "@/components/audit/audit-filters";

const MAX_ROWS = 20_000;
const CHUNK = 1000;

function plain(status: number, message: string): NextResponse {
  return new NextResponse(message, { status, headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" } });
}

export async function GET(request: NextRequest, context: RouteContext<"/projects/[projectId]/audit/export">) {
  const { projectId } = await context.params;
  if (!isUuid(projectId)) return plain(404, "We couldn't find that project.");

  try {
    const supabase = await createClient();
    const { data: claims } = await supabase.auth.getClaims();
    if (!claims?.claims?.sub) return plain(401, "Your session has ended. Sign in again, then export.");

    const { data: project, error } = await supabase
      .from("project_overview")
      .select("id, name, my_company_role, my_project_role")
      .eq("id", projectId)
      .maybeSingle();
    if (error) throw error;
    if (!project?.id || !project.name) return plain(404, "We couldn't find that project. It may have been deleted, or you no longer have access.");
    const permissions = projectPermissions({ companyRole: project.my_company_role, projectRole: project.my_project_role });
    if (!permissions.canExport) return plain(403, "You don't have permission to export this project's audit trail.");

    const filters = parseAuditFilters(request.nextUrl.searchParams);
    const entries: AuditEntry[] = [];
    let cursor: AuditCursor | null = null;
    let truncated = false;
    do {
      const page = await fetchAuditEntries(supabase, project.id, filters, { cursor, limit: CHUNK });
      entries.push(...page.entries);
      cursor = page.nextCursor;
      if (entries.length >= MAX_ROWS && cursor) {
        truncated = true;
        break;
      }
    } while (cursor);

    let personName: string | null = null;
    if (filters.person) {
      personName = filters.person === SYSTEM_ACTOR ? "System" : (entries.find((e) => e.actorId === filters.person)?.actorName ?? null);
    }

    const now = new Date();
    const csv = buildAuditCsv({
      projectName: project.name,
      generatedAt: now,
      filterSummary: describeAuditFilters(filters, personName),
      entries: entries.slice(0, MAX_ROWS),
      truncated,
    });
    const filename = auditCsvFilename(project.name, todayInManila(now));
    return new NextResponse(csv, {
      status: 200,
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="${filename}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
        "cache-control": "no-store",
      },
    });
  } catch (error) {
    const appError = toAppError(error);
    return plain(appError.code === "NETWORK" ? 503 : 500, appError.message);
  }
}
