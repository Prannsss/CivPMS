import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";
import { cn } from "@/lib/utils";
import type { BadgeTone } from "./badge";

const iconTones: Record<BadgeTone, string> = {
  neutral: "bg-neutral-soft text-neutral-text",
  primary: "bg-primary-soft text-primary-text",
  info: "bg-info-soft text-info-text",
  success: "bg-success-soft text-success-text",
  warning: "bg-warning-soft text-warning-text",
  orange: "bg-orange-soft text-orange-text",
  danger: "bg-danger-soft text-danger-text",
};

const deltaTones = {
  positive: "text-success-text",
  negative: "text-danger-text",
  neutral: "text-muted-foreground",
} as const;

export type StatCardProps = Omit<React.ComponentProps<"div">, "children"> & {
  label: React.ReactNode;
  value: React.ReactNode;
  icon?: React.ReactNode;
  tone?: BadgeTone;
  /** e.g. { value: "+4.2%", trend: "up", sentiment: "positive" } */
  delta?: {
    value: React.ReactNode;
    trend: "up" | "down" | "flat";
    /** Whether the change is good, bad or neutral (an "up" in cost is bad). */
    sentiment?: keyof typeof deltaTones;
  };
  hint?: React.ReactNode;
  /** Optional footer content (meter, progress). */
  footer?: React.ReactNode;
};

/** KPI tile: label, big tabular value, optional icon, delta and hint. */
export function StatCard({ label, value, icon, tone = "primary", delta, hint, footer, className, ...props }: StatCardProps) {
  const TrendIcon = delta?.trend === "up" ? ArrowUpRight : delta?.trend === "down" ? ArrowDownRight : Minus;
  return (
    <div
      data-slot="stat-card"
      className={cn("flex flex-col gap-3 rounded-lg border border-border bg-surface p-5 shadow-xs", className)}
      {...props}
    >
      <div className="flex items-start justify-between gap-3">
        <p className="text-[13px] leading-5 font-medium text-muted-foreground">{label}</p>
        {icon ? (
          <span
            aria-hidden
            className={cn("grid size-9 shrink-0 place-items-center rounded-md [&_svg]:size-[18px]", iconTones[tone])}
          >
            {icon}
          </span>
        ) : null}
      </div>
      <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
        <p className="text-[26px] leading-8 font-semibold tracking-[-0.02em] text-foreground tabular-nums">{value}</p>
        {delta ? (
          <span
            className={cn(
              "inline-flex items-center gap-0.5 text-xs font-semibold tabular-nums",
              deltaTones[delta.sentiment ?? "neutral"],
            )}
          >
            <TrendIcon aria-hidden className="size-3.5" />
            {delta.value}
          </span>
        ) : null}
      </div>
      {hint ? <p className="-mt-1.5 text-xs leading-4 text-muted-foreground">{hint}</p> : null}
      {footer ? <div className="pt-1">{footer}</div> : null}
    </div>
  );
}
