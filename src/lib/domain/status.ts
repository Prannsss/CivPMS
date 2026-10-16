/**
 * Activity statuses, status ↔ % rules (spec §10.3), derived Delayed (§10.5, A15)
 * and escalation tagging (§10.6).
 */
import { diffDays, type ISODate } from "./dates";

export const ACTIVITY_STATUSES = ["not_started", "ongoing", "delayed", "on_hold", "completed"] as const;
export type ActivityStatus = (typeof ACTIVITY_STATUSES)[number];

const ACTIVITY_STATUS_LABELS: Record<ActivityStatus, string> = {
  not_started: "Not Started",
  ongoing: "Ongoing",
  delayed: "Delayed",
  on_hold: "On-Hold",
  completed: "Completed",
};

export function isActivityStatus(value: unknown): value is ActivityStatus {
  return typeof value === "string" && (ACTIVITY_STATUSES as readonly string[]).includes(value);
}

export function activityStatusLabel(status: ActivityStatus): string {
  return ACTIVITY_STATUS_LABELS[status];
}

/** Allowed % range per status (spec §10.3). */
export const STATUS_PERCENT_RANGE: Record<ActivityStatus, { min: number; max: number }> = {
  not_started: { min: 0, max: 0 },
  ongoing: { min: 1, max: 99 },
  delayed: { min: 0, max: 99 },
  on_hold: { min: 0, max: 99 },
  completed: { min: 100, max: 100 },
};

/**
 * Checks the status ↔ % consistency rules of spec §10.3.
 * Returns null when valid, otherwise a plain-language message saying what is wrong and how to fix it.
 */
export function validateStatusPercent(status: ActivityStatus, percent: number): string | null {
  if (!Number.isInteger(percent) || percent < 0 || percent > 100) {
    return "Progress must be a whole number from 0 to 100.";
  }
  const label = activityStatusLabel(status);
  switch (status) {
    case "not_started":
      return percent === 0 ? null : "Not Started activities are at 0%. Set progress to 0% or choose Ongoing.";
    case "ongoing":
      if (percent === 0) return "Ongoing activities need at least 1% progress. Enter 1–99% or choose Not Started.";
      if (percent === 100) return "Ongoing activities are below 100%. Enter 1–99% or choose Completed.";
      return null;
    case "delayed":
    case "on_hold":
      return percent <= 99 ? null : `${label} activities are below 100%. Enter 0–99% or choose Completed.`;
    case "completed":
      return percent === 100 ? null : "Completed activities are at 100%. Set progress to 100% or choose another status.";
  }
}

/**
 * The % a form should pre-fill when the user picks a status: Completed → 100, Not Started → 0,
 * others keep the current value clamped into their allowed range (On-Hold "keeps current by default").
 */
export function percentForStatus(status: ActivityStatus, currentPercent: number): number {
  const { min, max } = STATUS_PERCENT_RANGE[status];
  const current = Number.isFinite(currentPercent) ? Math.round(currentPercent) : 0;
  return Math.min(max, Math.max(min, current));
}

/**
 * A note is required when setting Delayed or On-Hold (A14) and when reopening a Completed
 * activity (§10.3). Unchanged statuses never require one.
 */
export function statusChangeRequiresNote(before: ActivityStatus, after: ActivityStatus): boolean {
  if (before === after) return false;
  return after === "delayed" || after === "on_hold" || before === "completed";
}

export type DerivedDelayReason = "END_PASSED" | "START_PASSED";

export interface DerivedDelayed {
  delayed: boolean;
  reason: DerivedDelayReason | null;
  /** Days since the planned end (or start) passed; 0 when not delayed. */
  days: number;
}

/**
 * Derived ("auto") Delayed per spec §10.5 / A15: true when (a) the planned end date has passed and
 * the activity isn't Completed, or (b) the planned start date has passed and it's still Not Started.
 * A date "has passed" when `today` is after it. End-passed takes precedence.
 */
export function derivedDelayed(input: {
  status: ActivityStatus;
  startDate: ISODate | null | undefined;
  endDate: ISODate | null | undefined;
  today: ISODate;
}): DerivedDelayed {
  const { status, startDate, endDate, today } = input;
  if (status === "completed") return { delayed: false, reason: null, days: 0 };
  if (endDate && today > endDate) {
    return { delayed: true, reason: "END_PASSED", days: diffDays(today, endDate) };
  }
  if (status === "not_started" && startDate && today > startDate) {
    return { delayed: true, reason: "START_PASSED", days: diffDays(today, startDate) };
  }
  return { delayed: false, reason: null, days: 0 };
}

export interface StatusSnapshot {
  status: ActivityStatus;
  percent: number;
}

/**
 * Escalation (§10.6): the status moves to Delayed or On-Hold, or the % decreases.
 */
export function isEscalation(before: StatusSnapshot, after: StatusSnapshot): boolean {
  const worseStatus = before.status !== after.status && (after.status === "delayed" || after.status === "on_hold");
  return worseStatus || after.percent < before.percent;
}
