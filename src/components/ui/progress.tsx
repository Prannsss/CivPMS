"use client";

import { Progress as ProgressPrimitive } from "radix-ui";
import { cn } from "@/lib/utils";

export type ProgressTone = "auto" | "primary" | "info" | "success" | "warning" | "orange" | "danger";

const fills: Record<Exclude<ProgressTone, "auto">, string> = {
  primary: "bg-primary",
  info: "bg-info",
  success: "bg-success",
  warning: "bg-warning",
  orange: "bg-orange",
  danger: "bg-danger",
};

const heights = { sm: "h-1.5", md: "h-2", lg: "h-3" } as const;

export type ProgressProps = Omit<React.ComponentProps<typeof ProgressPrimitive.Root>, "value" | "max"> & {
  /** 0–100. `null` renders an indeterminate bar. */
  value: number | null;
  /** `auto`: blue while in progress, green at 100%. */
  tone?: ProgressTone;
  size?: keyof typeof heights;
  /** Visible label above the bar (also the accessible name). */
  label?: React.ReactNode;
  /** Show "64%" on the label row. */
  showValue?: boolean;
};

export function Progress({
  value,
  tone = "auto",
  size = "md",
  label,
  showValue = false,
  className,
  ...props
}: ProgressProps) {
  const clamped = value === null ? null : Math.min(100, Math.max(0, value));
  const resolvedTone = tone === "auto" ? (clamped !== null && clamped >= 100 ? "success" : "primary") : tone;
  const pct = clamped === null ? null : Math.round(clamped);

  const bar = (
    <ProgressPrimitive.Root
      value={clamped}
      max={100}
      getValueLabel={(v) => `${Math.round(v)}%`}
      className={cn("relative w-full overflow-hidden rounded-full bg-surface-sunken dark:bg-border", heights[size], className)}
      {...props}
    >
      <ProgressPrimitive.Indicator
        className={cn(
          "h-full rounded-full transition-[width] duration-300 ease-out",
          fills[resolvedTone],
          clamped === null && "w-2/5 animate-indeterminate",
        )}
        style={clamped === null ? undefined : { width: `${clamped}%` }}
      />
    </ProgressPrimitive.Root>
  );

  if (!label && !showValue) return bar;

  return (
    <div className="flex w-full flex-col gap-1.5">
      <div className="flex items-baseline justify-between gap-3 text-[13px] leading-5">
        {label ? <span className="truncate font-medium text-foreground">{label}</span> : <span />}
        {showValue && pct !== null ? <span className="font-medium text-muted-foreground tabular-nums">{pct}%</span> : null}
      </div>
      {bar}
    </div>
  );
}
