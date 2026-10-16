import { Gauge, TriangleAlert } from "lucide-react";
import { NEAR_BUDGET_THRESHOLD } from "@/lib/constants";
import { cn } from "@/lib/utils";
import { formatPesoCompact } from "./format";

export type BudgetState = "within" | "near" | "exceeded";

/** within: < threshold · near: threshold … 100% · exceeded: > 100% (spec §5.3). */
export function getBudgetState(allocated: number, budget: number, threshold = NEAR_BUDGET_THRESHOLD): BudgetState {
  if (budget <= 0) return allocated > 0 ? "exceeded" : "within";
  const ratio = allocated / budget;
  if (ratio > 1) return "exceeded";
  if (ratio >= threshold) return "near";
  return "within";
}

export type MeterProps = Omit<React.ComponentProps<"div">, "children"> & {
  /** Σ estimated cost of leaf activities. */
  allocated: number;
  /** Project budget. */
  budget: number;
  label?: React.ReactNode;
  threshold?: number;
  /** Money formatter (defaults to compact pesos: ₱8.2M). */
  formatValue?: (value: number) => string;
  size?: "sm" | "md";
  /** Hide the summary line under the bar. */
  hideSummary?: boolean;
};

const fills: Record<BudgetState, string> = {
  within: "bg-primary",
  near: "bg-warning",
  exceeded: "bg-danger",
};

/**
 * Budget meter: allocated vs budget with near/exceeded coloring, e.g.
 * "₱8.2M of ₱10M · ₱1.8M remaining". Color is always paired with text and an icon.
 */
export function Meter({
  allocated,
  budget,
  label = "Budget allocated",
  threshold = NEAR_BUDGET_THRESHOLD,
  formatValue = formatPesoCompact,
  size = "md",
  hideSummary = false,
  className,
  ...props
}: MeterProps) {
  const state = getBudgetState(allocated, budget, threshold);
  const ratio = budget > 0 ? allocated / budget : allocated > 0 ? Infinity : 0;
  const pct = Number.isFinite(ratio) ? Math.round(ratio * 100) : null;
  const remaining = budget - allocated;

  // When over budget the bar represents the allocation; a marker shows where the budget ends.
  const fillWidth = state === "exceeded" ? 100 : Math.max(0, Math.min(100, ratio * 100));
  const budgetMarker = state === "exceeded" && Number.isFinite(ratio) ? (1 / ratio) * 100 : null;

  const summary =
    remaining >= 0
      ? `${formatValue(allocated)} of ${formatValue(budget)} · ${formatValue(remaining)} remaining`
      : `${formatValue(allocated)} of ${formatValue(budget)} · ${formatValue(-remaining)} over budget`;

  return (
    <div
      role="meter"
      aria-valuemin={0}
      aria-valuemax={budget}
      aria-valuenow={allocated}
      aria-valuetext={summary}
      aria-label={typeof label === "string" ? label : "Budget allocated"}
      data-state={state}
      className={cn("flex w-full flex-col gap-1.5", className)}
      {...props}
    >
      <div className="flex items-center justify-between gap-3 text-[13px] leading-5">
        <span className="truncate font-medium text-foreground">{label}</span>
        <span
          className={cn(
            "inline-flex items-center gap-1 font-semibold tabular-nums",
            state === "within" && "text-muted-foreground",
            state === "near" && "text-warning-text",
            state === "exceeded" && "text-danger-text",
          )}
        >
          {state === "near" ? <Gauge aria-hidden className="size-3.5" /> : null}
          {state === "exceeded" ? <TriangleAlert aria-hidden className="size-3.5" /> : null}
          {pct === null ? "—" : `${pct}%`}
        </span>
      </div>
      <div
        aria-hidden
        className={cn(
          "relative w-full overflow-hidden rounded-full bg-surface-sunken dark:bg-border",
          size === "md" ? "h-2" : "h-1.5",
        )}
      >
        <div
          className={cn("h-full rounded-full transition-[width] duration-300 ease-out", fills[state])}
          style={{ width: `${fillWidth}%` }}
        />
        {budgetMarker !== null ? (
          <div
            className="absolute inset-y-0 w-0.5 bg-surface"
            style={{ left: `calc(${budgetMarker}% - 1px)` }}
          />
        ) : null}
        {state === "within" ? (
          <div
            className="absolute inset-y-0 w-px bg-border-strong dark:bg-input"
            style={{ left: `${threshold * 100}%` }}
          />
        ) : null}
      </div>
      {hideSummary ? null : (
        <p
          className={cn(
            "text-xs leading-4 tabular-nums",
            state === "exceeded" ? "font-medium text-danger-text" : "text-muted-foreground",
          )}
        >
          {summary}
        </p>
      )}
    </div>
  );
}
