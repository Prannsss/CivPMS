import {
  BanknoteArrowUp,
  Circle,
  CircleCheck,
  CircleDashed,
  CircleDot,
  CirclePause,
  CirclePlay,
  CircleX,
  Gauge,
  TriangleAlert,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge, type BadgeProps, type BadgeTone } from "./badge";

/** Manual activity statuses (spec §10.1). */
export const ACTIVITY_STATUSES = ["not_started", "ongoing", "delayed", "on_hold", "completed"] as const;
export type ActivityStatus = (typeof ACTIVITY_STATUSES)[number];

/** Manual project statuses (spec §5.2). */
export const PROJECT_STATUSES = ["planning", "active", "on_hold", "completed", "cancelled"] as const;
export type ProjectStatus = (typeof PROJECT_STATUSES)[number];

/** Derived project badges (spec §5.3), shown alongside the status. */
export const DERIVED_BADGES = ["delayed", "budget_exceeded", "near_budget_limit"] as const;
export type DerivedBadge = (typeof DERIVED_BADGES)[number];

export type StatusKey = ActivityStatus | ProjectStatus | DerivedBadge;

export type StatusMeta = { label: string; tone: BadgeTone; icon: LucideIcon };

/**
 * Single source of truth for status color + icon + label (never color alone).
 * Delayed is a red chip with an icon — never a solid red button — so it is not mistaken for a
 * destructive action.
 */
export const STATUS_META: Record<StatusKey, StatusMeta> = {
  not_started: { label: "Not Started", tone: "neutral", icon: Circle },
  ongoing: { label: "Ongoing", tone: "info", icon: CircleDot },
  delayed: { label: "Delayed", tone: "danger", icon: TriangleAlert },
  on_hold: { label: "On-Hold", tone: "orange", icon: CirclePause },
  completed: { label: "Completed", tone: "success", icon: CircleCheck },
  planning: { label: "Planning", tone: "neutral", icon: CircleDashed },
  active: { label: "Active", tone: "primary", icon: CirclePlay },
  cancelled: { label: "Cancelled", tone: "neutral", icon: CircleX },
  budget_exceeded: { label: "Budget Exceeded", tone: "danger", icon: BanknoteArrowUp },
  near_budget_limit: { label: "Near Budget Limit", tone: "warning", icon: Gauge },
};

export function getStatusMeta(status: StatusKey): StatusMeta {
  return STATUS_META[status];
}
export function getStatusTone(status: StatusKey): BadgeTone {
  return STATUS_META[status].tone;
}
export function getStatusLabel(status: StatusKey): string {
  return STATUS_META[status].label;
}
export function getStatusIcon(status: StatusKey): LucideIcon {
  return STATUS_META[status].icon;
}

export type StatusBadgeProps = Omit<BadgeProps, "tone" | "icon" | "children"> & {
  status: StatusKey;
  /** Override the default label (e.g. "Delayed · 3 days"). */
  label?: React.ReactNode;
  /** Hide the icon (only when the label already disambiguates, e.g. in dense tables with a legend). */
  hideIcon?: boolean;
};

export function StatusBadge({ status, label, hideIcon, className, ...props }: StatusBadgeProps) {
  const meta = STATUS_META[status];
  const Icon = meta.icon;
  return (
    <Badge
      tone={meta.tone}
      icon={hideIcon ? undefined : <Icon strokeWidth={2.25} />}
      data-status={status}
      className={cn(className)}
      {...props}
    >
      {label ?? meta.label}
    </Badge>
  );
}
