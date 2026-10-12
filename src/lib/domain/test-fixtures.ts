/** Test-only builders shared by the domain test files. */
import type { ActivityRecord } from "./wbs";

let seq = 0;

export function record(partial: Partial<ActivityRecord> & { id: string }): ActivityRecord {
  seq += 1;
  return {
    parentId: null,
    sortOrder: seq,
    name: partial.id,
    startDate: null,
    durationHours: null,
    endDate: null,
    estCost: null,
    status: "not_started",
    percent: 0,
    delayedReported: false,
    version: 1,
    ...partial,
  };
}
