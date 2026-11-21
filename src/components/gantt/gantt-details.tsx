"use client";

import Link from "next/link";
import { ListTree, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { StatusBadge } from "@/components/ui/status-badge";
import {
  formatDateRange,
  formatDuration,
  formatPercent,
  formatPeso,
  levelLabel,
  varianceLabel,
  type DurationUnit,
  type GanttRow,
} from "@/lib/domain";
import { cn } from "@/lib/utils";

/** Facts about the selected row (spec §9.1 hover/selection details), with a link to edit it. */
export function GanttDetails({
  row,
  durationUnit,
  hoursPerDay,
  baselineVersion,
  wbsHref,
  onClose,
}: {
  row: GanttRow;
  durationUnit: DurationUnit;
  hoursPerDay: number;
  /** Shown when the baseline overlay is on. */
  baselineVersion: number | null;
  wbsHref: string;
  onClose: () => void;
}) {
  const variance = varianceLabel(row.finishVariance);
  return (
    <section
      aria-label={`Details of ${row.wbsCode} ${row.name}`}
      data-testid="gantt-details"
      className="flex flex-col gap-4 rounded-lg border border-border bg-surface p-4 shadow-xs sm:p-5"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <p className="text-xs leading-4 text-muted-foreground">
            <span className="font-mono tabular-nums">{row.wbsCode}</span> · {levelLabel(row.level)}
          </p>
          <h2 className="text-h3 break-words">{row.name}</h2>
        </div>
        <IconButton aria-label="Close details" variant="ghost" size="sm" onClick={onClose}>
          <X aria-hidden />
        </IconButton>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <StatusBadge status={row.status} />
        {row.delay.reason ? <span className="text-[13px] leading-5 text-danger-text">{row.delay.reason}</span> : null}
        {row.containsDelayed ? <span className="text-[13px] leading-5 text-danger-text">Contains delayed work packages</span> : null}
      </div>

      <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm sm:grid-cols-4">
        <Fact label="Dates" value={row.start && row.end ? formatDateRange(row.start, row.end) : "Not scheduled"} />
        <Fact label="Duration" value={row.isMilestone ? "Milestone" : formatDuration(row.hours, durationUnit, hoursPerDay)} />
        <Fact label="Estimated cost" value={formatPeso(row.cost)} />
        <Fact label="Progress" value={formatPercent(row.percent)} />
        {baselineVersion !== null ? (
          <>
            <Fact
              label={`Baseline v${baselineVersion}`}
              value={row.baseline?.start && row.baseline.end ? formatDateRange(row.baseline.start, row.baseline.end) : "Not in this baseline"}
            />
            {variance ? (
              <Fact
                label="Finish vs baseline"
                value={variance}
                valueClassName={row.finishVariance !== null && row.finishVariance > 0 ? "text-danger-text" : undefined}
              />
            ) : null}
          </>
        ) : null}
      </dl>

      <div>
        <Button asChild variant="outline" size="sm">
          <Link href={wbsHref}>
            <ListTree aria-hidden />
            Open in Work Breakdown
          </Link>
        </Button>
      </div>
    </section>
  );
}

function Fact({ label, value, valueClassName }: { label: string; value: string; valueClassName?: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <dt className="text-xs leading-4 text-muted-foreground">{label}</dt>
      <dd className={cn("font-medium break-words tabular-nums", valueClassName)}>{value}</dd>
    </div>
  );
}
