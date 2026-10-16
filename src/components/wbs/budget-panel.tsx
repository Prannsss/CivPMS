"use client";

/**
 * Live budget allocation and project totals above the WBS (spec §6.4 "warn, don't block").
 * Recomputes while a cost is being typed, so the bar moves before anything is saved.
 */
import { memo, useMemo } from "react";
import { CalendarRange, Layers, Scale, TrendingUp, TriangleAlert } from "lucide-react";
import { Meter } from "@/components/ui";
import {
  budgetAllocation,
  buildTree,
  formatDate,
  formatDateRange,
  formatDuration,
  formatPercent,
  formatPeso,
  pluralize,
  projectRollup,
  type DurationUnit,
  type ISODate,
} from "@/lib/domain";
import { cn } from "@/lib/utils";
import type { WbsActivity } from "./types";

export type BudgetPanelProps = {
  records: ReadonlyArray<WbsActivity>;
  budget: number;
  weighting: "cost" | "hours";
  threshold: number;
  unit: DurationUnit;
  hoursPerDay: number;
  today: ISODate;
};

export const BudgetPanel = memo(function BudgetPanel({
  records,
  budget,
  weighting,
  threshold,
  unit,
  hoursPerDay,
  today,
}: BudgetPanelProps) {
  const { totals, deliverables } = useMemo(() => {
    const { roots } = buildTree(records);
    return { totals: projectRollup(roots, { weighting, today }), deliverables: roots.length };
  }, [records, weighting, today]);
  const allocation = budgetAllocation(budget, totals.cost, threshold);
  const remainingText =
    allocation.remaining >= 0
      ? `${formatPeso(allocation.remaining)} remaining`
      : `${formatPeso(-allocation.remaining)} over budget`;

  return (
    <div className="flex flex-col">
      <div
        data-testid="wbs-budget"
        data-state={allocation.state}
        className="grid grid-cols-3 gap-x-4 gap-y-5 rounded-lg border border-border bg-surface p-4 shadow-xs sm:gap-x-6 sm:p-6 lg:grid-cols-[minmax(0,2fr)_repeat(3,minmax(0,1fr))]"
      >
        <div className="col-span-3 flex min-w-0 flex-col gap-2 lg:col-span-1">
          <Meter
            allocated={totals.cost}
            budget={budget}
            threshold={threshold}
            label="Budget allocated"
            hideSummary
          />
          <p className="flex flex-wrap items-baseline gap-x-1.5 text-[13px] leading-5 tabular-nums">
            <span className="font-semibold text-foreground" data-testid="wbs-allocated">
              {formatPeso(totals.cost)}
            </span>
            <span className="text-muted-foreground">of {formatPeso(budget)}</span>
            <span aria-hidden className="text-muted-foreground">
              ·
            </span>
            <span
              className={cn(
                allocation.state === "exceeded" ? "font-medium text-danger-text" : "text-muted-foreground",
                allocation.state === "near" && "font-medium text-warning-text",
              )}
            >
              {remainingText}
            </span>
          </p>
        </div>
        <Stat icon={<Layers />} label="Structure">
          {pluralize(deliverables, "deliverable")}
          <Sub>{pluralize(totals.leafCount, "work package")}</Sub>
        </Stat>
        <Stat icon={<CalendarRange />} label="Schedule">
          {totals.startDate && totals.endDate
            ? formatDateRange(totals.startDate, totals.endDate)
            : totals.startDate
              ? `From ${formatDate(totals.startDate)}`
              : "Not scheduled yet"}
          <Sub>{totals.hours > 0 ? `${formatDuration(totals.hours, unit, hoursPerDay)} of work` : "No durations yet"}</Sub>
        </Stat>
        <Stat icon={<TrendingUp />} label="Progress">
          {formatPercent(totals.percent)}
          <Sub>Weighted by {weighting === "cost" ? "cost" : "hours"}</Sub>
        </Stat>
        {allocation.state !== "ok" || totals.usedFallbackWeight ? (
          <ul className="col-span-3 -mb-1 flex flex-col gap-2 border-t border-border pt-3 lg:col-span-4">
            {allocation.state === "exceeded" ? (
              <Note tone="danger" testId="wbs-budget-warning" title={`Over budget by ${formatPeso(-allocation.remaining)}.`}>
                Changes still save. Lower some work package costs or raise the budget in Project settings.
              </Note>
            ) : allocation.state === "near" ? (
              <Note tone="warning" testId="wbs-budget-warning" title="Close to the budget limit.">
                {Math.round(allocation.ratio * 100)}% is allocated, so {formatPeso(allocation.remaining)} is left for any
                work not costed yet.
              </Note>
            ) : null}
            {totals.usedFallbackWeight ? (
              <Note tone="info" testId="wbs-fallback" title="Progress is less precise for some work packages.">
                They have no {weighting === "cost" ? "estimated cost" : "duration"} yet, so they are weighted by{" "}
                {weighting === "cost" ? "hours" : "cost"} or equally. Add {weighting === "cost" ? "costs" : "durations"}{" "}
                to make the percentages accurate.
              </Note>
            ) : null}
          </ul>
        ) : null}
      </div>
    </div>
  );
});

const NOTE_TONES = {
  danger: { Icon: TriangleAlert, icon: "text-danger-text", title: "text-danger-text" },
  warning: { Icon: TriangleAlert, icon: "text-warning-text", title: "text-warning-text" },
  info: { Icon: Scale, icon: "text-primary-text", title: "text-foreground" },
} as const;

function Note({
  tone,
  title,
  testId,
  children,
}: {
  tone: keyof typeof NOTE_TONES;
  title: string;
  testId: string;
  children: React.ReactNode;
}) {
  const t = NOTE_TONES[tone];
  return (
    <li
      data-testid={testId}
      role={tone === "info" ? undefined : "status"}
      className="flex items-start gap-2 text-xs leading-[1.125rem] text-muted-foreground"
    >
      <t.Icon aria-hidden className={cn("mt-px size-3.5 shrink-0", t.icon)} />
      <span>
        <span className={cn("font-medium", t.title)}>{title}</span> {children}
      </span>
    </li>
  );
}

function Stat({ icon, label, children }: { icon: React.ReactNode; label: string; children: React.ReactNode }) {
  return (
    <div className="flex min-w-0 items-start gap-3">
      <span
        aria-hidden
        className="hidden size-9 shrink-0 place-items-center rounded-md bg-surface-sunken text-muted-foreground sm:grid [&_svg]:size-4"
      >
        {icon}
      </span>
      <div className="flex min-w-0 flex-col">
        <span className="text-xs leading-4 font-medium text-muted-foreground">{label}</span>
        <span className="mt-0.5 flex min-w-0 flex-col text-[13px] leading-5 font-semibold text-foreground tabular-nums sm:text-sm">
          {children}
        </span>
      </div>
    </div>
  );
}

function Sub({ children }: { children: React.ReactNode }) {
  return <span className="text-xs leading-4 font-normal text-pretty text-muted-foreground">{children}</span>;
}
