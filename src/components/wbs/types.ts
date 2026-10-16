import type { ActivityNode, DurationUnit, ISODate, ProjectStatus, Rollup, WorkingCalendar } from "@/lib/domain";
import type { TrashItem, WbsActivity } from "@/server/queries/wbs";

export type { TrashItem, WbsActivity };

export type WbsNode = ActivityNode<WbsActivity>;

export type WbsView = "graph" | "list";

export interface WbsProjectInfo {
  id: string;
  name: string;
  budget: number;
  startDate: ISODate;
  endDate: ISODate;
  status: ProjectStatus;
  weighting: "cost" | "hours";
  nearBudgetThreshold: number;
}

/** Why the WBS is read-only for the viewer (null = editable). */
export type WbsLockReason = "role" | "completed" | "cancelled" | null;

export interface WbsWorkspaceProps {
  project: WbsProjectInfo;
  activities: WbsActivity[];
  trash: TrashItem[];
  calendar: WorkingCalendar;
  durationUnit: DurationUnit;
  today: ISODate;
  lockReason: WbsLockReason;
  /** The viewer may restore from the trash (manager), even if the WBS is locked for a closed project. */
  isManager: boolean;
}

export type RollupMap = ReadonlyMap<string, Rollup>;
