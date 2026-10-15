"use server";

/**
 * "Load more" for the Audit Trail (keyset pagination). A read, so it lives next to the page rather
 * than in src/server/actions; RLS decides which rows come back, exactly like the page itself.
 */
import { z } from "zod";
import { decodeAuditCursor, encodeAuditCursor, parseAuditFilters } from "@/components/audit/audit-filters";
import { fail, failFrom, fromZodError, ok, runAction, type ActionResult } from "@/lib/action-result";
import { createClient } from "@/lib/supabase/server";
import { fetchAuditEntries, type AuditEntry } from "@/server/queries/audit";

export interface AuditPageChunk {
  entries: AuditEntry[];
  nextCursor: string | null;
}

const inputSchema = z.object({
  projectId: z.uuid({ error: "This project link is not valid. Reload the page." }),
  /** The page's current query string (filters). */
  query: z.string().max(2000),
  cursor: z.string().max(100),
});

export async function loadMoreAuditEntries(input: {
  projectId: string;
  query: string;
  cursor: string;
}): Promise<ActionResult<AuditPageChunk>> {
  return runAction(async () => {
    const parsed = inputSchema.safeParse(input);
    if (!parsed.success) return fromZodError(parsed.error);
    const cursor = decodeAuditCursor(parsed.data.cursor);
    if (!cursor) return fail("VALIDATION", "Reload the page to see more entries.");
    const filters = parseAuditFilters(new URLSearchParams(parsed.data.query));
    try {
      const supabase = await createClient();
      const page = await fetchAuditEntries(supabase, parsed.data.projectId, filters, { cursor });
      return ok({ entries: page.entries, nextCursor: page.nextCursor ? encodeAuditCursor(page.nextCursor) : null });
    } catch (error) {
      return failFrom(error);
    }
  });
}
