"use client";

/**
 * Live budget allocation and project totals above the WBS (spec §6.4 "warn, don't block").
 * Recomputes while a cost is being typed, so the bar moves before anything is saved.
 */
import { memo, useMemo } from "react";
import { CalendarRange, Layers, Scale, TrendingUp } from "lucide-react";
import { Meter } from "@/components/ui";
import {
  budgetAllocation,
  buildTree,
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
import { Notice } from "./notice";
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
    <div className="flex flex-col gap-3">
      <div
        data-testid="wbs-budget"
        data-state={allocation.state}
        className="grid gap-x-6 gap-y-5 rounded-lg border border-border bg-surface p-5 shadow-xs sm:grid-cols-3 lg:grid-cols-[minmax(0,2fr)_repeat(3,minmax(0,1fr))] sm:p-6"
      >
        <div className="flex min-w-0 flex-col gap-2 sm:col-span-3 lg:col-span-1">
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
          {totals.startDate ? formatDateRange(totals.startDate, totals.endDate) : "Not scheduled yet"}
          <Sub>{totals.hours > 0 ? `${formatDuration(totals.hours, unit, hoursPerDay)} of work` : "No durations yet"}</Sub>
        </Stat>
        <Stat icon={<TrendingUp />} label="Progress">
          {formatPercent(totals.percent)}
          <Sub>Weighted by {weighting === "cost" ? "cost" : "hours"}</Sub>
        </Stat>
      </div>

      {allocation.state === "exceeded" ? (
        <Notice tone="danger" title="Allocated cost is over the project budget" data-testid="wbs-budget-warning">
          Work packages add up to {formatPeso(totals.cost)}, which is {formatPeso(-allocation.remaining)} more than the{" "}
          {formatPeso(budget)} budget. Changes still save — lower some costs or raise the budget in Project settings.
        </Notice>
      ) : allocation.state === "near" ? (
        <Notice tone="warning" title="Close to the budget limit" data-testid="wbs-budget-warning">
          {Math.round(allocation.ratio * 100)}% of the budget is allocated; {formatPeso(allocation.remaining)} is left
          for the rest of the work.
        </Notice>
      ) : null}

      {totals.usedFallbackWeight ? (
        <Notice tone="info" icon={<Scale />} title="Progress is less precise for some work packages" data-testid="wbs-fallback">
          Progress is weighted by {weighting === "cost" ? "estimated cost" : "hours"}, but some work packages have no{" "}
          {weighting === "cost" ? "cost" : "hours"} yet, so they count by {weighting === "cost" ? "hours" : "cost"} or
          equally. Add {weighting === "cost" ? "estimated costs" : "durations"} to make the percentages accurate.
        </Notice>
      ) : null}
    </div>
  );
});

function Stat({ icon, label, children }: { icon: React.ReactNode; label: string; children: React.ReactNode }) {
  return (
    <div className="flex min-w-0 items-start gap-3">
      <span
        aria-hidden
        className="grid size-9 shrink-0 place-items-center rounded-md bg-surface-sunken text-muted-foreground [&_svg]:size-4"
      >
        {icon}
      </span>
      <div className="flex min-w-0 flex-col">
        <span className="text-xs leading-4 font-medium text-muted-foreground">{label}</span>
        <span className="mt-0.5 flex min-w-0 flex-col text-sm leading-5 font-semibold text-foreground tabular-nums">
          {children}
        </span>
      </div>
    </div>
  );
}

function Sub({ children }: { children: React.ReactNode }) {
  return <span className="truncate text-xs leading-4 font-normal text-muted-foreground">{children}</span>;
}
