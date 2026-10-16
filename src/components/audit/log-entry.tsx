import Link from "next/link";
import { ArrowRight, Smartphone, TriangleAlert } from "lucide-react";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { formatDateTime, formatRelativeTime, formatTime } from "@/lib/domain/format";
import { cn } from "@/lib/utils";
import type { AuditEntry } from "@/server/queries/audit";
import { entityLabel, observedDiffers, viaLabel } from "./audit-format";

/**
 * One activity-log entry: actor, summary (old → new), WBS code and name, via, and the recorded
 * time in Manila (plus the observed time when it differs, spec §10.6). `compact` is the dashboard's
 * "Recent activity" line.
 */

const ARROW = " → ";

/** Renders "Budget: ₱1 → ₱2" with a visible arrow and the new value emphasised. */
export function ChangeSummary({ summary }: { summary: string }) {
  const index = summary.lastIndexOf(ARROW);
  if (index < 0) return <>{summary}</>;
  const before = summary.slice(0, index);
  const after = summary.slice(index + ARROW.length);
  const colon = before.indexOf(": ");
  const label = colon > 0 ? before.slice(0, colon + 1) : null;
  const oldValue = colon > 0 ? before.slice(colon + 2) : before;
  return (
    <>
      {label ? <span>{label} </span> : null}
      <span className="text-muted-foreground line-through decoration-border-strong">{oldValue}</span>
      <ArrowRight aria-label="changed to" className="mx-1 inline size-3.5 align-[-2px] text-muted-foreground" />
      <span className="font-medium">{after}</span>
    </>
  );
}

function WbsTag({ projectId, entry }: { projectId: string; entry: AuditEntry }) {
  if (!entry.wbsCode && !entry.activityName) return null;
  // "Added 3.2 Sidewalk…" already names the activity: keep only the (linked) WBS code.
  const nameInSummary = Boolean(entry.activityName && entry.summary.includes(entry.activityName));
  const label = (
    <>
      {entry.wbsCode ? <span className="font-mono text-[11px] tabular-nums">{entry.wbsCode}</span> : null}
      {entry.activityName && !nameInSummary ? <span className="truncate">{entry.activityName}</span> : null}
      {nameInSummary && entry.activityId ? <span>in WBS</span> : null}
    </>
  );
  const className =
    "inline-flex max-w-full min-w-0 items-center gap-1.5 rounded-xs bg-surface-sunken px-1.5 py-0.5 text-xs text-foreground";
  return entry.activityId ? (
    <Link
      href={`/projects/${projectId}/wbs?activity=${entry.activityId}`}
      className={cn(className, "transition-colors hover:bg-primary-soft hover:text-primary-text focus-ring")}
    >
      {label}
    </Link>
  ) : (
    <span className={className}>{label}</span>
  );
}

export function LogEntry({
  entry,
  projectId,
  now,
  compact = false,
}: {
  entry: AuditEntry;
  projectId: string;
  now: string;
  compact?: boolean;
}) {
  const showObserved = observedDiffers(entry.recordedAt, entry.observedAt);
  return (
    <div className="flex min-w-0 gap-3">
      <span aria-hidden className="pt-0.5">
        <Avatar name={entry.actorName} src={entry.actorAvatarUrl} size="sm" />
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <p className="text-sm leading-5 text-foreground">
          <span className="font-semibold">{entry.actorName}</span>
          <span className="sr-only">: </span>
          <span className="ml-1.5 break-words">
            <ChangeSummary summary={entry.summary} />
          </span>
        </p>
        {entry.note ? (
          <p className="rounded-sm border-l-2 border-border-strong bg-surface-muted px-2.5 py-1 text-[13px] leading-5 text-muted-foreground">
            “{entry.note}”
          </p>
        ) : null}
        <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs leading-4 text-muted-foreground">
          {compact ? (
            <time dateTime={entry.recordedAt} title={formatDateTime(entry.recordedAt)} className="tabular-nums">
              {formatRelativeTime(entry.recordedAt, now)}
            </time>
          ) : (
            <time dateTime={entry.recordedAt} title={formatDateTime(entry.recordedAt)} className="tabular-nums">
              {formatTime(entry.recordedAt)}
            </time>
          )}
          {showObserved && entry.observedAt ? (
            <span className="inline-flex items-center gap-1 tabular-nums">
              <Smartphone aria-hidden className="size-3" />
              observed {formatTime(entry.observedAt)}
            </span>
          ) : null}
          {!compact ? <span aria-hidden>·</span> : null}
          {!compact ? <span>{entityLabel(entry.entityType)}</span> : null}
          {!compact && entry.via !== "direct" ? (
            <Badge size="sm" tone="neutral" variant="outline">
              via {viaLabel(entry.via)}
            </Badge>
          ) : null}
          {entry.isEscalation ? (
            <Badge size="sm" tone="orange" icon={<TriangleAlert />}>
              Escalation
            </Badge>
          ) : null}
          <WbsTag projectId={projectId} entry={entry} />
        </div>
      </div>
    </div>
  );
}
