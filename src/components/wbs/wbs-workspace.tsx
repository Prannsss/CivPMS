"use client";

/**
 * The Work Breakdown screen (spec §6, §9.3): header with Graph | List and Hours | Days toggles,
 * live budget allocation, read-only banners, the list (inline edit, drag & drop) or graph view,
 * add / rename dialogs, delete with Undo and the "Recently deleted" panel.
 */
import { memo, useCallback, useMemo, useState, useTransition } from "react";
import { ChevronsDownUp, ChevronsUpDown, History, List, Network, Plus, Search, X } from "lucide-react";
import { Button, IconButton, Input, PageHeader, SegmentedControl, toast } from "@/components/ui";
import {
  buildTree,
  canMove,
  canMoveMessage,
  createCalendarIndex,
  findNode,
  rollupTree,
  type CalendarIndex,
  type DurationUnit,
} from "@/lib/domain";
import { setDurationUnit } from "@/server/actions/wbs";
import { ActivityDialog, type ActivityDialogMode } from "./activity-dialog";
import { BudgetPanel } from "./budget-panel";
import { indexAmongSiblings } from "./model";
import { Notice } from "./notice";
import { TrashSheet } from "./trash-sheet";
import type { WbsNode, WbsView, WbsWorkspaceProps } from "./types";
import { useStoredChoice } from "./use-stored-choice";
import { useWbsController } from "./use-wbs-controller";
import { WbsEmptyState } from "./wbs-empty-state";
import { WbsProvider, type MoveAvailability, type MoveCommand, type WbsHandlers } from "./wbs-context";
import { WbsGraph } from "./wbs-graph";
import { WbsTable } from "./wbs-table";

const VIEWS = ["list", "graph"] as const;
const VIEW_OPTIONS = [
  { value: "graph" as const, label: "Graph", icon: <Network /> },
  { value: "list" as const, label: "List", icon: <List /> },
];
const UNIT_OPTIONS = [
  { value: "hours" as const, label: "Hours" },
  { value: "days" as const, label: "Days" },
];

const LOCK_COPY = {
  role: {
    title: "View only",
    body: "Only the project's PMs and the Owner PM can change the work breakdown. You can still see every value and switch between list and graph.",
  },
  completed: {
    title: "This project is completed, so its work breakdown is locked",
    body: "Reopen the project from Project settings to change deliverables, dates or costs.",
  },
  cancelled: {
    title: "This project is cancelled, so its work breakdown is locked",
    body: "Cancelled projects keep their plan for the record and can't be edited.",
  },
} as const;

function siblingList(roots: WbsNode[], parentId: string | null): WbsNode[] {
  if (parentId === null) return roots;
  return findNode(roots, parentId)?.children ?? [];
}

export function WbsWorkspace({
  project,
  activities,
  trash,
  calendar,
  durationUnit,
  today,
  lockReason,
}: WbsWorkspaceProps) {
  const canEdit = lockReason === null;
  const calendarIndex = useMemo<CalendarIndex | null>(() => {
    try {
      return createCalendarIndex(calendar);
    } catch {
      return null;
    }
  }, [calendar]);

  const controller = useWbsController({ project, initial: activities, calendarIndex });
  const { records } = controller;
  const roots = useMemo(() => buildTree(records).roots as WbsNode[], [records]);
  const rollups = useMemo(
    () => rollupTree(roots, { weighting: project.weighting, today }),
    [roots, project.weighting, today],
  );

  const [view, setView] = useStoredChoice<WbsView>("civpms.wbs.view", VIEWS, "list");
  const [unit, setUnit] = useState<DurationUnit>(durationUnit);
  const [, startUnitTransition] = useTransition();
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => new Set());
  const [filter, setFilter] = useState("");
  const [draftCosts, setDraftCosts] = useState<ReadonlyMap<string, number | null>>(() => new Map());
  const [dialog, setDialog] = useState<ActivityDialogMode | null>(null);
  const [trashOpen, setTrashOpen] = useState(false);

  const parentIds = useMemo(() => {
    const ids: string[] = [];
    const visit = (nodes: WbsNode[]) => {
      for (const node of nodes) {
        if (node.children.length > 0) {
          ids.push(node.id);
          visit(node.children);
        }
      }
    };
    visit(roots);
    return ids;
  }, [roots]);

  const changeUnit = useCallback(
    (next: DurationUnit) => {
      setUnit(next);
      startUnitTransition(async () => {
        const result = await setDurationUnit({ unit: next });
        if (!result.ok) {
          toast.error("Couldn't remember that choice", {
            description: "It applies on this page, but will reset next time. " + result.error.message,
          });
        }
      });
    },
    [],
  );

  const toggle = useCallback((id: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const draftCost = useCallback((id: string, value: number | null | undefined) => {
    setDraftCosts((prev) => {
      const next = new Map(prev);
      if (value === undefined) next.delete(id);
      else next.set(id, value);
      return next;
    });
  }, []);

  const { move, remove, update, create } = controller;

  const moveAvailability = useCallback(
    (node: WbsNode): MoveAvailability => {
      const siblings = siblingList(roots, node.parentId);
      const index = siblings.findIndex((s) => s.id === node.id);
      const previous = index > 0 ? siblings[index - 1] : undefined;
      const parent = node.parentId ? findNode(roots, node.parentId) : null;
      const indentCheck = previous ? canMove(roots, node.id, previous.id) : null;
      const outdentCheck = parent ? canMove(roots, node.id, parent.parentId) : null;
      return {
        up: index > 0 ? { ok: true } : { ok: false, reason: "Already first in its group." },
        down: index < siblings.length - 1 ? { ok: true } : { ok: false, reason: "Already last in its group." },
        indent: !previous
          ? { ok: false, reason: "Needs an item above it at the same level." }
          : indentCheck && !indentCheck.ok
            ? { ok: false, reason: canMoveMessage(indentCheck.reason) }
            : { ok: true },
        outdent: !parent
          ? { ok: false, reason: "Deliverables are already the top level." }
          : outdentCheck && !outdentCheck.ok
            ? { ok: false, reason: canMoveMessage(outdentCheck.reason) }
            : { ok: true },
      };
    },
    [roots],
  );

  const moveBy = useCallback(
    (node: WbsNode, command: MoveCommand) => {
      const availability = moveAvailability(node);
      const state = availability[command];
      if (!state.ok) {
        toast.error("Can't move it there", { description: state.reason });
        return;
      }
      const siblings = siblingList(roots, node.parentId);
      const index = siblings.findIndex((s) => s.id === node.id);
      if (command === "up") void move(node, node.parentId, index - 1);
      else if (command === "down") void move(node, node.parentId, index + 1);
      else if (command === "indent") {
        const previous = siblings[index - 1]!;
        void move(node, previous.id, previous.children.length);
      } else {
        const parent = findNode(roots, node.parentId!)!;
        const parentIndex = indexAmongSiblings(records, parent.id);
        void move(node, parent.parentId, parentIndex + 1);
      }
    },
    [moveAvailability, move, records, roots],
  );

  const onMove = useCallback(
    (node: WbsNode, parentId: string | null, index: number) => void move(node, parentId, index),
    [move],
  );

  const handlers = useMemo<WbsHandlers>(
    () => ({
      canEdit,
      unit,
      hoursPerDay: calendar.hoursPerDay,
      calendarIndex,
      update: (activity, patch) => update(activity, patch),
      addChild: (node) => setDialog({ kind: "create", parent: node }),
      addSibling: (node) =>
        setDialog({
          kind: "create",
          parent: node.parentId ? findNode(roots, node.parentId) : null,
          index: indexAmongSiblings(records, node.id) + 1,
        }),
      rename: (node) => setDialog({ kind: "rename", node }),
      remove: (node) => void remove(node),
      moveBy,
      moveAvailability,
      toggle,
      draftCost,
    }),
    [canEdit, unit, calendar.hoursPerDay, calendarIndex, update, roots, records, remove, moveBy, moveAvailability, toggle, draftCost],
  );

  const projectRecords = useMemo(() => {
    if (draftCosts.size === 0) return records;
    return records.map((r) => (draftCosts.has(r.id) ? { ...r, estCost: draftCosts.get(r.id) ?? null } : r));
  }, [records, draftCosts]);

  const isEmpty = roots.length === 0;
  const filterText = filter.trim().toLowerCase();
  const lock = lockReason ? LOCK_COPY[lockReason] : null;

  return (
    <WbsProvider value={handlers}>
      <div className="flex min-w-0 flex-col gap-5" data-testid="wbs-workspace">
        <PageHeader
          className="pb-0 sm:pb-0"
          title="Work Breakdown"
          description="Deliverables, sub-deliverables and work packages. Parents roll up from their work packages."
          actions={
            <>
              <SegmentedControl
                aria-label="View"
                options={VIEW_OPTIONS}
                value={view}
                onValueChange={setView}
              />
              <SegmentedControl
                aria-label="Show durations in"
                options={UNIT_OPTIONS}
                value={unit}
                onValueChange={changeUnit}
              />
              {canEdit && !isEmpty ? (
                <Button onClick={() => setDialog({ kind: "create", parent: null })}>
                  <Plus /> Add deliverable
                </Button>
              ) : null}
            </>
          }
        />

        {lock ? (
          <Notice tone="neutral" title={lock.title} data-testid="wbs-lock">
            {lock.body}
          </Notice>
        ) : null}

        <BudgetPanel
          records={projectRecords}
          budget={project.budget}
          weighting={project.weighting}
          threshold={project.nearBudgetThreshold}
          unit={unit}
          hoursPerDay={calendar.hoursPerDay}
          today={today}
        />

        {isEmpty ? (
          <WbsEmptyState
            canEdit={canEdit}
            onAdd={() => setDialog({ kind: "create", parent: null })}
            onSample={controller.addSample}
          />
        ) : (
          <section aria-label="Work breakdown" className="flex min-w-0 flex-col gap-3">
            <Toolbar
              filter={filter}
              onFilter={setFilter}
              onExpandAll={() => setCollapsed(new Set())}
              onCollapseAll={() => setCollapsed(new Set(parentIds))}
              canCollapse={parentIds.length > 0}
              trashCount={canEdit ? trash.length : null}
              onOpenTrash={() => setTrashOpen(true)}
              showFilter={view === "list"}
            />
            {view === "list" ? (
              <p className="-mt-1 text-xs leading-4 text-muted-foreground sm:hidden">
                Swipe the table sideways to see and edit every column.
              </p>
            ) : null}
            {view === "list" ? (
              <WbsTable
                roots={roots}
                rollups={rollups}
                collapsed={collapsed}
                filter={filterText}
                busyIds={controller.busyIds}
                onMove={onMove}
              />
            ) : (
              <WbsGraph projectName={project.name} roots={roots} rollups={rollups} collapsed={collapsed} />
            )}
            <p className="text-xs leading-4 text-muted-foreground">
              {canEdit
                ? view === "list"
                  ? "Click a work package's value to edit it. Drag the handle to reorder; drag sideways to change its level. Every row's menu has keyboard-friendly moves."
                  : "Drag to pan, scroll or pinch to zoom. Click a card's arrow to collapse its branch; use the list view to edit values."
                : view === "list"
                  ? "Parents show values rolled up from their work packages."
                  : "Drag to pan, scroll or pinch to zoom. Click a card's arrow to collapse its branch."}
            </p>
          </section>
        )}
      </div>

      <ActivityDialog
        mode={dialog}
        onOpenChange={(open) => {
          if (!open) setDialog(null);
        }}
        projectStart={project.startDate}
        unit={unit}
        hoursPerDay={calendar.hoursPerDay}
        onCreate={create}
        onRename={(node, name) => update(node, { name })}
      />

      {canEdit ? (
        <TrashSheet open={trashOpen} onOpenChange={setTrashOpen} items={trash} onRestore={controller.restore} />
      ) : null}
    </WbsProvider>
  );
}

const Toolbar = memo(function Toolbar({
  filter,
  onFilter,
  onExpandAll,
  onCollapseAll,
  canCollapse,
  trashCount,
  onOpenTrash,
  showFilter,
}: {
  filter: string;
  onFilter: (value: string) => void;
  onExpandAll: () => void;
  onCollapseAll: () => void;
  canCollapse: boolean;
  trashCount: number | null;
  onOpenTrash: () => void;
  showFilter: boolean;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {showFilter ? (
        <div className="w-full sm:w-72">
          <Input
            type="search"
            value={filter}
            onChange={(event) => onFilter(event.target.value)}
            aria-label="Filter by name or WBS code"
            placeholder="Filter by name or WBS code"
            leading={<Search aria-hidden />}
            trailing={
              filter ? (
                <IconButton aria-label="Clear filter" size="sm" variant="ghost" tooltip={false} onClick={() => onFilter("")}>
                  <X />
                </IconButton>
              ) : null
            }
          />
        </div>
      ) : null}
      <div className="flex flex-wrap items-center gap-1">
        <Button variant="ghost" size="sm" onClick={onExpandAll} disabled={!canCollapse}>
          <ChevronsUpDown /> Expand<span className="-ml-1 hidden sm:inline"> all</span>
        </Button>
        <Button variant="ghost" size="sm" onClick={onCollapseAll} disabled={!canCollapse}>
          <ChevronsDownUp /> Collapse<span className="-ml-1 hidden sm:inline"> all</span>
        </Button>
      </div>
      {trashCount !== null ? (
        <Button variant="ghost" size="sm" className="ml-auto" onClick={onOpenTrash}>
          <History /> <span className="sm:hidden">Deleted</span>
          <span className="hidden sm:inline">Recently deleted</span>
          {trashCount > 0 ? (
            <span className="rounded-full bg-surface-sunken px-1.5 text-xs font-semibold tabular-nums text-muted-foreground">
              {trashCount}
            </span>
          ) : null}
        </Button>
      ) : null}
    </div>
  );
});
