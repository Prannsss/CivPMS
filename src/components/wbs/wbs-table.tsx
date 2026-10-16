"use client";

/**
 * WBS list view (spec §9.3): an indented tree table with sticky header and first columns, zebra
 * rows and tabular numbers. Leaves are edited inline by managers; parents show rolled-up values.
 * Rows are re-ordered and re-parented by drag and drop (dnd-kit): dragging sideways changes the
 * level, `canMove` explains invalid drops, and every move gets an Undo snackbar.
 */
import { memo, useCallback, useId, useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  closestCenter,
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragMoveEvent,
  type DragOverEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { SortableContext, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { ChevronRight, GripVertical, TriangleAlert } from "lucide-react";
import { Progress, StatusBadge, toast } from "@/components/ui";
import {
  canMove,
  canMoveMessage,
  countWorkingDays,
  flattenTree,
  formatDate,
  formatDateRange,
  formatDuration,
  formatPercent,
  formatPeso,
  levelLabel,
  pluralize,
  type FlatWbsRow,
  type Rollup,
} from "@/lib/domain";
import { cn } from "@/lib/utils";
import { CostCell, DateCell, DurationCell, TextCell } from "./inline-edit";
import { getProjection, nodeLabel, type Projection } from "./model";
import { RowActions } from "./row-actions";
import type { RollupMap, WbsNode } from "./types";
import { useWbs } from "./wbs-context";

const INDENT = 18;
/** Above this many visible rows the list renders only what is on screen (500+ rows stay smooth). */
const VIRTUALIZE_AT = 150;

export type WbsTableProps = {
  roots: WbsNode[];
  rollups: RollupMap;
  collapsed: ReadonlySet<string>;
  /** Lower-cased filter text; rows that match (and their ancestors) stay visible. */
  filter: string;
  busyIds: ReadonlySet<string>;
  onMove: (node: WbsNode, parentId: string | null, index: number) => void;
};

function matchesFilter(node: WbsNode, filter: string): boolean {
  return node.name.toLowerCase().includes(filter) || node.wbsCode.startsWith(filter);
}

/** Ids of nodes that match the filter plus all of their ancestors. */
function visibleForFilter(roots: WbsNode[], filter: string): Set<string> {
  const keep = new Set<string>();
  const visit = (node: WbsNode, path: WbsNode[]): void => {
    if (matchesFilter(node, filter)) {
      keep.add(node.id);
      for (const ancestor of path) keep.add(ancestor.id);
    }
    for (const child of node.children) visit(child, [...path, node]);
  };
  for (const root of roots) visit(root, []);
  return keep;
}

/** Memoised: typing a cost (live budget bar) re-renders the workspace but not the 500+ rows. */
export const WbsTable = memo(function WbsTable({ roots, rollups, collapsed, filter, busyIds, onMove }: WbsTableProps) {
  const wbs = useWbs();
  const dndId = useId();
  const [activeId, setActiveId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);
  const [offsetX, setOffsetX] = useState(0);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  const rows = useMemo(() => {
    const hidden = new Set(collapsed);
    if (activeId) hidden.add(activeId);
    if (!filter) return flattenTree(roots, hidden);
    const keep = visibleForFilter(roots, filter);
    return flattenTree(roots, new Set()).filter((row) => keep.has(row.id));
  }, [roots, collapsed, activeId, filter]);

  const ids = useMemo(() => rows.map((r) => r.id), [rows]);

  const scrollRef = useRef<HTMLDivElement>(null);
  const virtual = rows.length > VIRTUALIZE_AT;
  // eslint-disable-next-line react-hooks/incompatible-library -- the virtualizer's own state drives these renders
  const virtualizer = useVirtualizer({
    count: virtual ? rows.length : 0,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 52,
    overscan: 12,
    // Render the first screenful on the server and before the container is measured (no empty flash).
    initialRect: { width: 1080, height: 900 },
    getItemKey: (i) => rows[i]?.id ?? i,
  });
  const virtualItems = virtual ? virtualizer.getVirtualItems() : [];
  const padTop = virtual && virtualItems.length > 0 ? virtualItems[0]!.start : 0;
  const padBottom =
    virtual && virtualItems.length > 0 ? virtualizer.getTotalSize() - virtualItems[virtualItems.length - 1]!.end : 0;
  const visible = virtual
    ? virtualItems.map((item) => ({ row: rows[item.index]!, index: item.index }))
    : rows.map((row, index) => ({ row, index }));
  const measure = virtual ? virtualizer.measureElement : undefined;
  const dragEnabled = wbs.canEdit && !filter;

  const projection: Projection | null = useMemo(() => {
    if (!activeId || !overId) return null;
    return getProjection(
      rows.map((r) => ({ id: r.id, parentId: r.parentId, depth: r.depth })),
      activeId,
      overId,
      offsetX,
      INDENT,
    );
  }, [rows, activeId, overId, offsetX]);

  const dropCheck = useMemo(() => {
    if (!activeId || !projection) return null;
    return canMove(roots, activeId, projection.parentId);
  }, [roots, activeId, projection]);

  const activeRow = activeId ? rows.find((r) => r.id === activeId) : undefined;

  function reset() {
    setActiveId(null);
    setOverId(null);
    setOffsetX(0);
  }

  function onDragStart(event: DragStartEvent) {
    setActiveId(String(event.active.id));
    setOverId(String(event.active.id));
  }
  function onDragMove(event: DragMoveEvent) {
    setOffsetX(event.delta.x);
  }
  function onDragOver(event: DragOverEvent) {
    setOverId(event.over ? String(event.over.id) : null);
  }
  function onDragEnd(event: DragEndEvent) {
    const finalProjection = projection;
    const check = dropCheck;
    const node = activeRow?.node;
    reset();
    if (!event.over || !finalProjection || !node) return;
    if (check && !check.ok) {
      toast.error("Can't move it there", { description: canMoveMessage(check.reason) });
      return;
    }
    onMove(node, finalProjection.parentId, finalProjection.index);
  }

  const totalColumns = 10;

  return (
    <DndContext
      id={dndId}
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragStart={onDragStart}
      onDragMove={onDragMove}
      onDragOver={onDragOver}
      onDragEnd={onDragEnd}
      onDragCancel={reset}
      accessibility={{
        screenReaderInstructions: {
          draggable:
            "To move an item with the keyboard, open its actions menu and choose Move up, Move down, Indent or Outdent.",
        },
      }}
    >
      <div
        ref={scrollRef}
        data-testid="wbs-table"
        data-virtual={virtual || undefined}
        className={cn(
          "relative w-full overflow-auto rounded-lg border border-border bg-surface shadow-xs",
          virtual ? "h-[calc(100dvh-10rem)] min-h-96" : "sm:max-h-[calc(100dvh-12rem)] sm:min-h-64",
        )}
      >
        <table className="w-full min-w-[69.75rem] table-fixed border-separate border-spacing-0 text-sm sm:min-w-[72rem] lg:min-w-[67.5rem]">
          <caption className="sr-only">
            Work breakdown: deliverables, sub-deliverables and work packages with dates, duration, hours, cost and
            progress. Parents roll up from their work packages.
          </caption>
          <colgroup>
            <col className="w-[4.5rem]" />
            {/* Phones: WBS + Name fill the screen (the summary line under the name shows the rest). */}
            <col className="w-[16.5rem] sm:w-auto" />
            <col className="w-[7rem]" />
            <col className="w-[6rem]" />
            <col className="w-[7rem]" />
            <col className="w-[4.5rem]" />
            <col className="w-[8.25rem]" />
            <col className="w-[5.75rem]" />
            <col className="w-[7.5rem]" />
            <col className="w-11" />
          </colgroup>
          <thead className="sticky top-0 z-20">
            <tr className="bg-surface-muted text-xs font-semibold whitespace-nowrap text-muted-foreground">
              <Th className="sticky left-0 z-30 bg-surface-muted pl-3">WBS</Th>
              <Th className="z-30 bg-surface-muted md:sticky md:left-[4.5rem] md:shadow-[1px_0_0_var(--border)]">
                Name
              </Th>
              <Th>Start</Th>
              <Th className="text-right">Duration</Th>
              <Th>End</Th>
              <Th className="text-right">Hours</Th>
              <Th className="text-right">Est. cost</Th>
              <Th>Progress</Th>
              <Th>Status</Th>
              <Th className="pr-3">
                <span className="sr-only">Actions</span>
              </Th>
            </tr>
          </thead>
          <SortableContext items={ids} strategy={verticalListSortingStrategy}>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={totalColumns} className="px-4 py-10 text-center text-sm text-muted-foreground">
                    Nothing matches “{filter}”. Try part of a name or a WBS code like 2.1.
                  </td>
                </tr>
              ) : (
                <>
                  {padTop > 0 ? <Spacer height={padTop} columns={totalColumns} /> : null}
                  {visible.map(({ row, index }) => (
                  <WbsRow
                    key={row.id}
                    index={index}
                    measure={measure}
                    zebra={index % 2 === 1}
                    row={row}
                    rollup={rollups.get(row.id)}
                    busy={busyIds.has(row.id)}
                    dragEnabled={dragEnabled}
                    isCollapsed={collapsed.has(row.id) && !filter}
                    projectedDepth={row.id === activeId && projection ? projection.depth : null}
                    invalidDrop={row.id === activeId && dropCheck !== null && !dropCheck.ok}
                  />
                  ))}
                  {padBottom > 0 ? <Spacer height={padBottom} columns={totalColumns} /> : null}
                </>
              )}
            </tbody>
          </SortableContext>
        </table>
      </div>
      <DragOverlay dropAnimation={null}>
        {activeRow ? (
          <div
            className={cn(
              "flex max-w-md items-center gap-2 rounded-md border bg-surface px-3 py-2 text-sm font-medium shadow-popover",
              dropCheck && !dropCheck.ok ? "border-danger text-danger-text" : "border-primary text-foreground",
            )}
          >
            <GripVertical aria-hidden className="size-4 text-muted-foreground" />
            <span className="font-mono text-xs text-muted-foreground">{activeRow.wbsCode}</span>
            <span className="truncate">{activeRow.node.name}</span>
            {dropCheck && !dropCheck.ok ? (
              <span className="ml-1 inline-flex shrink-0 items-center gap-1 text-xs">
                <TriangleAlert aria-hidden className="size-3.5" /> Can&apos;t drop here
              </span>
            ) : projection ? (
              <span className="ml-1 shrink-0 text-xs font-normal text-muted-foreground">
                → {levelLabel(projection.depth + 1)}
              </span>
            ) : null}
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
});

function Spacer({ height, columns }: { height: number; columns: number }) {
  return (
    <tr aria-hidden style={{ height }}>
      <td colSpan={columns} className="p-0" />
    </tr>
  );
}

function Th({ className, children }: { className?: string; children?: React.ReactNode }) {
  return (
    <th scope="col" className={cn("h-10 border-b border-border px-3 text-left align-middle", className)}>
      {children}
    </th>
  );
}

type WbsRowProps = {
  row: FlatWbsRow<WbsNode>;
  /** Position in the visible list (zebra stripes, virtual measuring). */
  index: number;
  zebra: boolean;
  measure: ((element: Element | null) => void) | undefined;
  rollup: Rollup | undefined;
  busy: boolean;
  dragEnabled: boolean;
  isCollapsed: boolean;
  projectedDepth: number | null;
  invalidDrop: boolean;
};

/**
 * Re-render guards for 500+ rows: the tree is rebuilt (new node and rollup objects) after every
 * edit, so rows compare what they display instead of object identity.
 */
function sameNode(a: WbsNode, b: WbsNode): boolean {
  return (
    a === b ||
    (a.id === b.id &&
      a.parentId === b.parentId &&
      a.name === b.name &&
      a.wbsCode === b.wbsCode &&
      a.level === b.level &&
      a.startDate === b.startDate &&
      a.durationHours === b.durationHours &&
      a.endDate === b.endDate &&
      a.estCost === b.estCost &&
      a.status === b.status &&
      a.version === b.version &&
      a.children.length === b.children.length)
  );
}

function sameRollup(a: Rollup | undefined, b: Rollup | undefined): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  const keys = Object.keys(a) as (keyof Rollup)[];
  return keys.length === Object.keys(b).length && keys.every((k) => a[k] === b[k]);
}

const WbsRow = memo(
  function WbsRow({
    row,
    index,
    zebra,
    measure,
    rollup,
    busy,
    dragEnabled,
    isCollapsed,
    projectedDepth,
    invalidDrop,
  }: WbsRowProps) {
    const { node } = row;
    const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({
      id: node.id,
      disabled: !dragEnabled,
    });
    const ref = useCallback(
      (element: HTMLTableRowElement | null) => {
        setNodeRef(element);
        measure?.(element);
      },
      [setNodeRef, measure],
    );
    const style: React.CSSProperties = { transform: CSS.Translate.toString(transform), transition };

    return (
      <tr
        ref={ref}
        style={style}
        data-index={index}
        data-testid="wbs-row"
        data-wbs-code={node.wbsCode}
        data-level={node.level}
        aria-busy={busy || undefined}
        className={cn(
          "group/row align-middle transition-colors hover:bg-surface-sunken",
          zebra ? "bg-surface-muted" : "bg-surface",
          isDragging && "relative z-10 bg-primary-soft opacity-80 outline-2 -outline-offset-2 outline-dashed outline-primary",
          isDragging && invalidDrop && "bg-danger-soft outline-danger",
          busy && "opacity-70",
        )}
      >
        {/* WBS code + drag handle */}
        <td className="sticky left-0 z-10 h-11 border-b border-border bg-inherit pr-1 pl-1 whitespace-nowrap">
          <div className="flex items-center gap-0.5">
            {dragEnabled ? (
              <button
                type="button"
                ref={setActivatorNodeRef}
                {...attributes}
                {...listeners}
                aria-label={`Drag ${node.wbsCode} ${node.name}`}
                className="grid size-8 shrink-0 cursor-grab touch-none place-items-center rounded-sm text-muted-foreground opacity-60 transition-opacity group-hover/row:opacity-100 hover:bg-surface-sunken hover:text-foreground focus-visible:opacity-100 focus-ring-inset active:cursor-grabbing"
              >
                <GripVertical aria-hidden className="size-4" />
              </button>
            ) : (
              <span className="w-2" aria-hidden />
            )}
            <span className="font-mono text-xs text-muted-foreground tabular-nums">{node.wbsCode}</span>
          </div>
        </td>
        <RowCells node={node} rollup={rollup} depth={projectedDepth ?? row.depth} isCollapsed={isCollapsed} />
      </tr>
    );
  },
  (a, b) =>
    sameNode(a.row.node, b.row.node) &&
    a.index === b.index &&
    a.zebra === b.zebra &&
    a.measure === b.measure &&
    a.row.depth === b.row.depth &&
    sameRollup(a.rollup, b.rollup) &&
    a.busy === b.busy &&
    a.dragEnabled === b.dragEnabled &&
    a.isCollapsed === b.isCollapsed &&
    a.projectedDepth === b.projectedDepth &&
    a.invalidDrop === b.invalidDrop,
);

type RowCellsProps = { node: WbsNode; rollup: Rollup | undefined; depth: number; isCollapsed: boolean };

/** Everything after the WBS code, memoised apart from the sortable wrapper (which re-renders on every drag). */
const RowCells = memo(
  function RowCells({ node, rollup, depth, isCollapsed }: RowCellsProps) {
    const wbs = useWbs();
    const isLeaf = node.children.length === 0;
    const editable = wbs.canEdit && isLeaf;
    const r = rollup;
    const hpd = wbs.hoursPerDay;
    const spanHours =
      !isLeaf && r?.startDate && r.endDate && wbs.calendarIndex
        ? countWorkingDays(wbs.calendarIndex, r.startDate, r.endDate) * hpd
        : null;
    const code = `${node.wbsCode} ${node.name}`;
    const derivedDelayed = isLeaf && r?.hasDelayed && node.status !== "delayed";
    const levelText = nodeLabel(node);
    // Phones see only the first columns without scrolling, so repeat the key values under the name.
    const mobileSummary = r
      ? [
          r.startDate && r.endDate ? formatDateRange(r.startDate, r.endDate) : null,
          r.hours > 0 ? formatDuration(r.hours, wbs.unit, hpd) : null,
          r.cost > 0 ? formatPeso(r.cost) : null,
        ]
          .filter(Boolean)
          .join(" · ")
      : "";
    const cellBg = "bg-inherit";
    const parentValue = "font-medium text-foreground";

    return (
      <>
      {/* Name (indented tree) */}
      <td
        className={cn(
          "z-10 border-b border-border py-1.5 pr-3 md:sticky md:left-[4.5rem] md:shadow-[1px_0_0_var(--border)]",
          cellBg,
        )}
      >
        <div className="flex min-w-0 items-center gap-1" style={{ paddingLeft: depth * INDENT }}>
          {node.children.length > 0 ? (
            <button
              type="button"
              onClick={() => wbs.toggle(node.id)}
              aria-expanded={!isCollapsed}
              aria-label={`${isCollapsed ? "Expand" : "Collapse"} ${code}`}
              className="grid size-7 shrink-0 place-items-center rounded-sm text-muted-foreground hover:bg-surface-sunken hover:text-foreground focus-ring-inset"
            >
              <ChevronRight
                aria-hidden
                className={cn("size-4 transition-transform duration-150", !isCollapsed && "rotate-90")}
              />
            </button>
          ) : (
            <span aria-hidden className="grid size-7 shrink-0 place-items-center">
              <span className="size-1.5 rounded-full bg-border-strong" />
            </span>
          )}
          <div className="flex min-w-0 flex-1 flex-col">
            <TextCell
              value={node.name}
              label={`Rename ${code}`}
              disabled={!wbs.canEdit}
              onCommit={(name) => wbs.update(node, { name })}
            >
              <span
                className={cn(
                  "line-clamp-2 min-w-0 leading-5 break-words",
                  node.level === 1 && "font-semibold text-foreground",
                  node.level === 2 && "font-medium text-foreground",
                  node.level >= 3 && "text-foreground",
                )}
                title={node.name}
              >
                {node.name}
              </span>
              <span className="sr-only">, {levelText}</span>
            </TextCell>
            {!isLeaf && r ? (
              <span className="truncate pl-0 text-xs leading-4 text-muted-foreground italic">
                from {pluralize(r.leafCount, "work package")}
              </span>
            ) : null}
            {mobileSummary ? (
              <span className="text-xs leading-4 text-pretty text-muted-foreground tabular-nums sm:hidden">
                {mobileSummary}
              </span>
            ) : null}
          </div>
        </div>
      </td>

      {/* Start */}
      <td className="border-b border-border px-3 whitespace-nowrap">
        {isLeaf ? (
          <DateCell
            value={node.startDate}
            label={`Start date of ${code}`}
            disabled={!editable}
            onCommit={(startDate) => wbs.update(node, { startDate })}
          />
        ) : (
          <DerivedText className={parentValue}>{r?.startDate ? formatDate(r.startDate) : "—"}</DerivedText>
        )}
      </td>

      {/* Duration */}
      <td className="border-b border-border px-3 text-right whitespace-nowrap">
        {isLeaf ? (
          <DurationCell
            hours={node.durationHours}
            unit={wbs.unit}
            hoursPerDay={hpd}
            label={`Duration of ${code} in ${wbs.unit}`}
            disabled={!editable}
            onCommit={(durationHours) => wbs.update(node, { durationHours })}
          >
            {node.durationHours === null ? (
              <span className="text-muted-foreground">{editable ? "Set" : "—"}</span>
            ) : node.durationHours === 0 ? (
              <span className="text-muted-foreground">Milestone</span>
            ) : (
              <span className="tabular-nums">{formatDuration(node.durationHours, wbs.unit, hpd)}</span>
            )}
          </DurationCell>
        ) : (
          <DerivedText className={cn(parentValue, "justify-end")}>
            {spanHours === null ? "—" : formatDuration(spanHours, wbs.unit, hpd)}
          </DerivedText>
        )}
      </td>

      {/* End */}
      <td className="border-b border-border px-3 whitespace-nowrap">
        {isLeaf ? (
          <DateCell
            value={node.endDate}
            min={node.startDate}
            label={`End date of ${code}`}
            disabled={!editable || !node.startDate}
            emptyText={node.startDate ? "Set date" : "—"}
            onCommit={(endDate) => wbs.update(node, { endDate })}
          />
        ) : (
          <DerivedText className={parentValue}>{r?.endDate ? formatDate(r.endDate) : "—"}</DerivedText>
        )}
      </td>

      {/* Hours */}
      <td className="border-b border-border px-3 text-right text-[13px] whitespace-nowrap tabular-nums">
        <span className={cn(isLeaf ? "text-muted-foreground" : parentValue)}>
          {r ? formatDuration(r.hours, "hours", hpd) : "—"}
        </span>
      </td>

      {/* Cost */}
      <td className="border-b border-border px-3 text-right whitespace-nowrap">
        {isLeaf ? (
          <CostCell
            value={node.estCost}
            label={`Estimated cost of ${code}`}
            disabled={!editable}
            onDraft={(value) => wbs.draftCost(node.id, value)}
            onCommit={(estCost) => wbs.update(node, { estCost })}
          >
            {node.estCost === null ? (
              <span className="text-muted-foreground">{editable ? "Set cost" : "—"}</span>
            ) : (
              <span className="tabular-nums">{formatPeso(node.estCost)}</span>
            )}
          </CostCell>
        ) : (
          <DerivedText className={cn(parentValue, "justify-end")}>{formatPeso(r?.cost ?? 0)}</DerivedText>
        )}
      </td>

      {/* Progress */}
      <td className="border-b border-border px-2.5">
        <div className="flex items-center gap-1.5">
          <Progress value={r?.percent ?? 0} size="sm" className="min-w-0 flex-1" aria-label={`Progress of ${code}`} />
          <span className="w-8 shrink-0 text-right text-xs text-muted-foreground tabular-nums">
            {formatPercent(r?.percent ?? 0)}
          </span>
        </div>
      </td>

      {/* Status */}
      <td className="border-b border-border px-2.5">
        <div className="flex min-w-0 items-center gap-1">
          {derivedDelayed ? (
            <StatusBadge status="delayed" size="sm" title="Its start or end date has passed" />
          ) : (
            <StatusBadge status={r?.status ?? node.status} size="sm" />
          )}
          {!isLeaf && r?.hasDelayed ? (
            <span className="inline-flex text-danger-text" title="Contains delayed work packages">
              <TriangleAlert aria-hidden className="size-3.5" />
              <span className="sr-only">Contains delayed work packages</span>
            </span>
          ) : null}
        </div>
      </td>

      {/* Actions */}
      <td className="border-b border-border pr-2 pl-1 text-right">
        <RowActions node={node} />
      </td>
      </>
    );
  },
  (a, b) =>
    sameNode(a.node, b.node) && sameRollup(a.rollup, b.rollup) && a.depth === b.depth && a.isCollapsed === b.isCollapsed,
);


function DerivedText({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <span
      className={cn("flex min-h-9 items-center text-[13px] tabular-nums", className)}
      title="Rolled up from its work packages"
    >
      {children}
    </span>
  );
}
