"use client";

/**
 * Client state + mutations for the WBS screens: an optimistic copy of the activities (re-synced
 * whenever the server sends fresh data), and the create / edit / move / delete / restore flows with
 * their confirm dialogs, Undo snackbars, "Changed by someone else" handling and budget warnings.
 */
import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast, useConfirm } from "@/components/ui";
import {
  budgetAllocation,
  buildTree,
  describeDeleteImpact,
  formatPeso,
  levelLabel,
  pluralize,
  projectRollup,
  type CalendarIndex,
} from "@/lib/domain";
import {
  createActivity,
  createSampleStructure,
  deleteActivity,
  moveActivity,
  restoreActivity,
  updateActivity,
  type UpdateActivityInput,
} from "@/server/actions/wbs";
import { applyMove, indexAmongSiblings, resolveLeafSchedule, type SchedulePatch } from "./model";
import type { WbsActivity, WbsNode, WbsProjectInfo } from "./types";

export type ActivityPatch = NonNullable<UpdateActivityInput["patch"]>;

export interface CreateValues {
  parentId: string | null;
  name: string;
  index?: number | null;
  startDate?: string | null;
  durationHours?: number | null;
  estCost?: number | null;
  carryFromParent?: boolean;
}

function allocatedOf(records: ReadonlyArray<WbsActivity>, weighting: "cost" | "hours"): number {
  return projectRollup(buildTree(records).roots, { weighting }).cost;
}

export function useWbsController({
  project,
  initial,
  calendarIndex,
}: {
  project: WbsProjectInfo;
  initial: WbsActivity[];
  calendarIndex: CalendarIndex | null;
}) {
  const router = useRouter();
  const confirm = useConfirm();
  const [, startTransition] = useTransition();
  const [records, setRecords] = useState<WbsActivity[]>(initial);
  const [syncedFrom, setSyncedFrom] = useState(initial);
  const [busyIds, setBusyIds] = useState<ReadonlySet<string>>(() => new Set());
  const recordsRef = useRef(records);
  useEffect(() => {
    recordsRef.current = records;
  }, [records]);

  // Fresh server data (after revalidation) replaces the optimistic copy.
  if (syncedFrom !== initial) {
    setSyncedFrom(initial);
    setRecords(initial);
  }

  const setBusy = useCallback((id: string, busy: boolean) => {
    setBusyIds((prev) => {
      const next = new Set(prev);
      if (busy) next.add(id);
      else next.delete(id);
      return next;
    });
  }, []);

  const replaceRecord = useCallback((activity: WbsActivity) => {
    // Update the ref right away: a queued save on the same row reads the new version next.
    const next = recordsRef.current.map((r) => (r.id === activity.id ? { ...r, ...activity } : r));
    recordsRef.current = next;
    setRecords(next);
  }, []);

  const warnIfBudgetCrossed = useCallback(
    (before: ReadonlyArray<WbsActivity>, after: ReadonlyArray<WbsActivity>) => {
      const was = budgetAllocation(project.budget, allocatedOf(before, project.weighting), project.nearBudgetThreshold);
      const now = budgetAllocation(project.budget, allocatedOf(after, project.weighting), project.nearBudgetThreshold);
      if (now.state === "exceeded" && was.state !== "exceeded") {
        toast.warning("Over budget — saved anyway", {
          description: `Allocated ${formatPeso(now.allocated)} is ${formatPeso(-now.remaining)} over the ${formatPeso(project.budget)} budget. Review costs or the budget.`,
        });
      } else if (now.state === "near" && was.state === "ok") {
        toast.warning("Near the budget limit", {
          description: `${formatPeso(now.remaining)} of ${formatPeso(project.budget)} remains unallocated.`,
        });
      }
    },
    [project.budget, project.nearBudgetThreshold, project.weighting],
  );

  /** Inline edit of one activity (name, dates, duration, cost). Returns true when saved. */
  /** Saves on the same activity run one after another, so each uses the version the last one returned. */
  const queues = useRef(new Map<string, Promise<boolean>>());

  const update = useCallback(
    (activity: WbsActivity, patch: ActivityPatch): Promise<boolean> => {
      const id = activity.id;
      const latest = () => recordsRef.current.find((r) => r.id === id) ?? activity;
      const original = latest();

      // Instant feedback: apply the same schedule rules the server will apply.
      let optimistic: WbsActivity = { ...original };
      if (patch.name !== undefined) optimistic.name = patch.name;
      if (patch.estCost !== undefined) optimistic.estCost = patch.estCost;
      const schedulePatch: SchedulePatch = {};
      if (patch.startDate !== undefined) schedulePatch.startDate = patch.startDate;
      if (patch.durationHours !== undefined) schedulePatch.durationHours = patch.durationHours;
      if (patch.endDate !== undefined) schedulePatch.endDate = patch.endDate;
      if (calendarIndex && Object.keys(schedulePatch).length > 0) {
        const resolved = resolveLeafSchedule(calendarIndex, original, schedulePatch);
        if (!resolved.ok) {
          toast.error("Couldn't save that change", { description: resolved.message });
          return Promise.resolve(false);
        }
        optimistic = { ...optimistic, ...resolved.schedule };
      }
      const before = recordsRef.current;
      const after = before.map((r) => (r.id === id ? optimistic : r));
      recordsRef.current = after;
      setRecords(after);

      const attempt = async (overwrite: boolean): Promise<boolean> => {
        setBusy(id, true);
        const result = await updateActivity({
          projectId: project.id,
          activityId: id,
          expectedVersion: latest().version,
          overwrite,
          patch,
        });
        setBusy(id, false);

        if (result.ok) {
          replaceRecord(result.data.activity);
          if (patch.estCost !== undefined) warnIfBudgetCrossed(before, after);
          if (result.data.endAdjusted && result.data.activity.endDate) {
            toast.info("End date moved to a working day", {
              description: `${activity.wbsCode} now ends on the last working day of that span.`,
            });
          }
          return true;
        }

        setRecords((prev) => prev.map((r) => (r.id === id ? { ...original, version: latest().version } : r)));
        if (result.error.code === "STALE_VERSION") {
          const keepMine = await confirm({
            title: "Changed by someone else just now",
            description: `Someone updated ${activity.wbsCode} ${activity.name} while you were editing. Reload to see their version, or keep yours to save over it.`,
            confirmLabel: "Keep mine",
            cancelLabel: "Reload",
          });
          if (keepMine) {
            setRecords((prev) => prev.map((r) => (r.id === id ? { ...optimistic, version: latest().version } : r)));
            return attempt(true);
          }
          startTransition(() => router.refresh());
          return false;
        }
        toast.error("Couldn't save that change", { description: result.error.message });
        return false;
      };

      const previous = queues.current.get(id) ?? Promise.resolve(true);
      const next = previous.then(
        () => attempt(false),
        () => attempt(false),
      );
      queues.current.set(id, next);
      return next;
    },
    [calendarIndex, confirm, project.id, replaceRecord, router, setBusy, warnIfBudgetCrossed],
  );

  const create = useCallback(
    async (
      values: CreateValues,
    ): Promise<
      { ok: true; activity: WbsActivity } | { ok: false; message: string; fieldErrors?: Record<string, string> }
    > => {
      const result = await createActivity({ projectId: project.id, ...values });
      if (!result.ok) return { ok: false, message: result.error.message, fieldErrors: result.error.fieldErrors };
      const activity = result.data.activity;
      setRecords((prev) => {
        const withoutParentValues = result.data.carried
          ? prev.map((r) =>
              r.id === values.parentId
                ? { ...r, startDate: null, endDate: null, durationHours: null, estCost: null }
                : r,
            )
          : prev;
        return applyMove([...withoutParentValues, activity], activity.id, activity.parentId, values.index ?? null);
      });
      toast.success(`${levelLabel(activity.level)} added`, {
        description: result.data.carried
          ? `${activity.wbsCode} ${activity.name} now carries the cost, hours and dates.`
          : `${activity.wbsCode} ${activity.name}`,
      });
      return { ok: true, activity };
    },
    [project.id],
  );

  /** Re-parent / reorder with an Undo snackbar that moves it back. */
  const move = useCallback(
    (activity: WbsActivity, newParentId: string | null, newIndex: number): Promise<void> => {
      const run = async (activity: WbsActivity, newParentId: string | null, newIndex: number, isUndo: boolean) => {
        const before = recordsRef.current;
        const oldParentId = activity.parentId;
        const oldIndex = indexAmongSiblings(before, activity.id);
        if (oldParentId === newParentId && oldIndex === newIndex) return;
        setRecords(applyMove(before, activity.id, newParentId, newIndex));
        setBusy(activity.id, true);
        const result = await moveActivity({ projectId: project.id, activityId: activity.id, newParentId, newIndex });
        setBusy(activity.id, false);
        if (!result.ok) {
          setRecords(before);
          toast.error("Couldn't move it there", { description: result.error.message });
          return;
        }
        if (!result.data.changed) return;
        if (isUndo) {
          toast.success("Move undone", { description: `${activity.name} is back at ${result.data.newWbsCode}.` });
          return;
        }
        toast.undo(
          `Moved to ${result.data.newWbsCode}`,
          () => {
            const current = recordsRef.current.find((r) => r.id === activity.id) ?? activity;
            void run(current, oldParentId, oldIndex, true);
          },
          { description: `${activity.name} (was ${result.data.oldWbsCode})` },
        );
      };
      return run(activity, newParentId, newIndex, false);
    },
    [project.id, setBusy],
  );

  const restore = useCallback(
    async (batchId: string, label?: string) => {
      const result = await restoreActivity({ projectId: project.id, batchId });
      if (!result.ok) {
        toast.error("Couldn't restore it", { description: result.error.message });
        return false;
      }
      toast.success("Restored", {
        description: `${result.data.wbsCode} ${label ?? result.data.name}${result.data.total > 1 ? ` and ${pluralize(result.data.total - 1, "sub-item")}` : ""}`,
      });
      startTransition(() => router.refresh());
      return true;
    },
    [project.id, router],
  );

  const remove = useCallback(
    async (node: WbsNode) => {
      const impact = describeDeleteImpact(node);
      const label = levelLabel(node.level).toLowerCase();
      const ok = await confirm({
        title: `Delete "${node.wbsCode} ${node.name}"?`,
        description: `${impact}. You can restore it from "Recently deleted" for 30 days.`,
        tone: "danger",
        confirmLabel: `Delete ${label}`,
      });
      if (!ok) return;
      const before = recordsRef.current;
      const doomed = new Set<string>([node.id]);
      for (const r of before) if (r.parentId && doomed.has(r.parentId)) doomed.add(r.id);
      // Parents always precede children in level order, but loop until stable for safety.
      let grew = true;
      while (grew) {
        grew = false;
        for (const r of before) {
          if (!doomed.has(r.id) && r.parentId && doomed.has(r.parentId)) {
            doomed.add(r.id);
            grew = true;
          }
        }
      }
      setRecords(before.filter((r) => !doomed.has(r.id)));
      const result = await deleteActivity({ projectId: project.id, activityId: node.id });
      if (!result.ok) {
        setRecords(before);
        toast.error("Couldn't delete it", { description: result.error.message });
        return;
      }
      toast.undo(`Deleted ${node.wbsCode} ${node.name}`, () => void restore(result.data.batchId, node.name), {
        description: impact.replace(/^Deletes/, "Removed"),
      });
    },
    [confirm, project.id, restore],
  );

  const addSample = useCallback(async () => {
    const result = await createSampleStructure({ projectId: project.id });
    if (!result.ok) {
      toast.error("Couldn't add the sample structure", { description: result.error.message });
      return false;
    }
    toast.success("Sample structure added", {
      description: `${pluralize(result.data.deliverables, "deliverable")} and ${pluralize(result.data.workPackages, "work package")}. Rename or delete anything that doesn't fit.`,
    });
    startTransition(() => router.refresh());
    return true;
  }, [project.id, router]);

  return useMemo(
    () => ({ records, busyIds, update, create, move, remove, restore, addSample }),
    [records, busyIds, update, create, move, remove, restore, addSample],
  );
}

export type WbsController = ReturnType<typeof useWbsController>;
