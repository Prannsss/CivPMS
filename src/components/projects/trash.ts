/** Pure helpers for the "Recently deleted" drawer and the create-project defaults. */
import { PROJECT_COLOR_KEYS, type ProjectColorKey } from "@/lib/constants";

const DAY_MS = 86_400_000;

/**
 * Whole days left before a trashed project can no longer be restored (rounded up, so "less than a
 * day" reads as 1). 0 once the deadline has passed or the date is invalid.
 */
export function restoreDaysLeft(restoreUntil: string, now: Date): number {
  const until = Date.parse(restoreUntil);
  if (!Number.isFinite(until)) return 0;
  const ms = until - now.getTime();
  return ms <= 0 ? 0 : Math.ceil(ms / DAY_MS);
}

/** "29 days left to restore", "1 day left to restore", "Can't be restored anymore". */
export function restoreDaysLabel(daysLeft: number): string {
  if (daysLeft <= 0) return "Can't be restored anymore";
  return `${daysLeft} ${daysLeft === 1 ? "day" : "days"} left to restore`;
}

/** Cycles through the card palette so new projects don't all come out blue. */
export function suggestedProjectColor(existingCount: number): ProjectColorKey {
  const index = ((existingCount % PROJECT_COLOR_KEYS.length) + PROJECT_COLOR_KEYS.length) % PROJECT_COLOR_KEYS.length;
  return PROJECT_COLOR_KEYS[index];
}
