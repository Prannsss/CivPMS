"use client";

import { useState } from "react";
import { History, SearchX } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { toast } from "@/components/ui/toaster";
import { loadMoreAuditEntries } from "@/app/(app)/projects/[projectId]/audit/actions";
import type { AuditEntry } from "@/server/queries/audit";
import { dayHeading, groupByDay } from "./audit-format";
import { LogEntry } from "./log-entry";

/**
 * The immutable log, grouped by Manila day, newest first, with keyset "Load more". Mount it with
 * `key={query}` so a filter change starts from the new first page.
 */
export function AuditLog({
  projectId,
  query,
  initialEntries,
  initialCursor,
  total,
  today,
  now,
  filtered,
  onClearHref,
}: {
  projectId: string;
  query: string;
  initialEntries: AuditEntry[];
  initialCursor: string | null;
  total: number | null;
  today: string;
  now: string;
  filtered: boolean;
  onClearHref: string;
}) {
  const [entries, setEntries] = useState(initialEntries);
  const [cursor, setCursor] = useState(initialCursor);
  const [loading, setLoading] = useState(false);

  async function loadMore() {
    if (!cursor) return;
    setLoading(true);
    const result = await loadMoreAuditEntries({ projectId, query, cursor });
    setLoading(false);
    if (!result.ok) {
      toast.error("Couldn't load more entries", {
        description: result.error.message,
        action: { label: "Retry", onClick: () => void loadMore() },
      });
      return;
    }
    setEntries((current) => {
      const seen = new Set(current.map((entry) => entry.id));
      return [...current, ...result.data.entries.filter((entry) => !seen.has(entry.id))];
    });
    setCursor(result.data.nextCursor);
  }

  if (entries.length === 0) {
    return filtered ? (
      <EmptyState
        icon={<SearchX />}
        title="No entries match these filters"
        description="Try a wider date range, another person or type, or clear the filters to see the whole history."
        action={
          <Button variant="outline" asChild>
            <a href={onClearHref}>Clear all filters</a>
          </Button>
        }
      />
    ) : (
      <EmptyState
        icon={<History />}
        title="No history yet"
        description="Every change to this project (details, status, work breakdown, calendar and team) is recorded here automatically and can't be edited or deleted."
      />
    );
  }

  const groups = groupByDay(entries);
  return (
    <div className="flex flex-col gap-6">
      {groups.map((group) => (
        <section key={group.day} aria-labelledby={`day-${group.day}`} className="flex flex-col gap-2">
          <h2
            id={`day-${group.day}`}
            className="sticky top-16 z-10 -mx-1 flex items-center gap-3 bg-background/95 px-1 py-1.5 text-label text-foreground backdrop-blur-sm lg:top-20"
          >
            {dayHeading(group.day, today)}
            <span className="text-xs font-normal text-muted-foreground tabular-nums">
              {group.items.length} {group.items.length === 1 ? "change" : "changes"}
            </span>
            <span aria-hidden className="h-px flex-1 bg-border" />
          </h2>
          <ol className="flex flex-col divide-y divide-border overflow-hidden rounded-lg border border-border bg-surface shadow-xs">
            {group.items.map((entry) => (
              <li key={entry.id} className="px-4 py-3.5 sm:px-5">
                <LogEntry entry={entry} projectId={projectId} now={now} />
              </li>
            ))}
          </ol>
        </section>
      ))}
      <div className="flex flex-col items-center gap-2 pb-2">
        <p className="text-xs text-muted-foreground tabular-nums" aria-live="polite">
          Showing {entries.length.toLocaleString("en-US")}
          {total !== null ? ` of ${total.toLocaleString("en-US")}` : ""} {total === 1 ? "entry" : "entries"}
        </p>
        {cursor ? (
          <Button variant="outline" onClick={loadMore} loading={loading} loadingText="Loading…">
            Load more
          </Button>
        ) : entries.length > 20 ? (
          <p className="text-xs text-muted-foreground">That&rsquo;s the beginning of this project&rsquo;s history.</p>
        ) : null}
      </div>
    </div>
  );
}
