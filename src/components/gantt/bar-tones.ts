import type { ActivityStatus } from "@/lib/domain";

/**
 * Bar colours per activity status (CLAUDE.md status semantics): soft fill, a strong outline that
 * keeps ≥ 3:1 against the surface, and a solid progress fill. Colour is never the only signal:
 * On-Hold bars are striped, overdue extensions hatched, and the grid shows the status icon.
 */
export const BAR_TONES: Record<ActivityStatus, { bar: string; fill: string; text: string }> = {
  not_started: { bar: "border-neutral-text/70 bg-neutral-soft", fill: "bg-neutral/45", text: "text-neutral-text" },
  ongoing: { bar: "border-info-text bg-info-soft", fill: "bg-info/70", text: "text-info-text" },
  delayed: { bar: "border-danger-text bg-danger-soft", fill: "bg-danger/70", text: "text-danger-text" },
  on_hold: {
    bar: "border-orange-text bg-orange-soft bg-[repeating-linear-gradient(135deg,transparent_0_4px,color-mix(in_oklab,var(--orange)_28%,transparent)_4px_8px)]",
    fill: "bg-orange/70",
    text: "text-orange-text",
  },
  completed: { bar: "border-success-text bg-success-soft", fill: "bg-success/75", text: "text-success-text" },
};

/** Hatched extension from a missed end date to today. */
export const OVERDUE_HATCH =
  "border-y-[1.5px] border-r-[1.5px] border-dashed border-danger-text/70 bg-[repeating-linear-gradient(135deg,color-mix(in_oklab,var(--danger)_40%,transparent)_0_3px,transparent_3px_7px)]";
