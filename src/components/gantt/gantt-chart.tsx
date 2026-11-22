"use client";

import * as React from "react";
import { ChevronRight } from "lucide-react";
import { STATUS_META } from "@/components/ui/status-badge";
import { SimpleTooltip, TruncatedText } from "@/components/ui/tooltip";
import {
  addDays,
  barGeometry,
  dateToX,
  formatDate,
  formatDateRange,
  formatPercent,
  type GanttRow,
  type ISODate,
  type NonWorkingRun,
  type TimelineHeader,
  type TimelineRange,
} from "@/lib/domain";
import { cn } from "@/lib/utils";
import { BAR_TONES, OVERDUE_HATCH } from "./bar-tones";

/** Row height in px (h-9). */
export const GANTT_ROW_HEIGHT = 36;

/** Width of the sticky WBS column: phones / tablets / desktop. Background layers use the same offsets. */
const LEFT_COL = "w-40 sm:w-64 lg:w-80";
const LEFT_OFFSET = "left-40 sm:left-64 lg:left-80";

export type GanttChartProps = {
  rows: GanttRow[];
  range: TimelineRange;
  dayWidth: number;
  header: TimelineHeader;
  nonWorking: NonWorkingRun[];
  today: ISODate;
  projectEnd: ISODate | null;
  overrun: { start: ISODate; end: ISODate } | null;
  showBaseline: boolean;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onToggle: (id: string, expand?: boolean) => void;
  /** Read by the parent for Today / Fit (scroll position and visible width). */
  scrollerRef: React.Ref<HTMLDivElement>;
  /** Screen-reader summary of the chart (the drawing itself is hidden from them). */
  summary: string;
  totalCount: number;
};

/**
 * Read-only Gantt grid: a sticky WBS column with a roving-focus tree, a sticky two-row timeline
 * header, and the bars. Everything scrolls inside its own box, so the page never scrolls sideways.
 */
export function GanttChart({
  rows,
  range,
  dayWidth,
  header,
  nonWorking,
  today,
  projectEnd,
  overrun,
  showBaseline,
  selectedId,
  onSelect,
  onToggle,
  scrollerRef,
  summary,
  totalCount,
}: GanttChartProps) {
  const timelineWidth = range.days * dayWidth;
  const showDayDetail = dayWidth >= 8;
  const todayInRange = today >= range.start && today <= range.end;
  const focusId = selectedId && rows.some((r) => r.id === selectedId) ? selectedId : (rows[0]?.id ?? null);
  const rowRefs = React.useRef(new Map<string, HTMLButtonElement>());

  function focusRow(index: number) {
    const row = rows[Math.max(0, Math.min(rows.length - 1, index))];
    if (!row) return;
    onSelect(row.id);
    rowRefs.current.get(row.id)?.focus();
  }

  function onRowKeyDown(event: React.KeyboardEvent<HTMLButtonElement>, index: number) {
    const row = rows[index];
    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        focusRow(index + 1);
        break;
      case "ArrowUp":
        event.preventDefault();
        focusRow(index - 1);
        break;
      case "Home":
        event.preventDefault();
        focusRow(0);
        break;
      case "End":
        event.preventDefault();
        focusRow(rows.length - 1);
        break;
      case "ArrowRight":
        if (row.hasChildren) {
          event.preventDefault();
          if (row.isCollapsed) onToggle(row.id, true);
          else focusRow(index + 1);
        }
        break;
      case "ArrowLeft": {
        event.preventDefault();
        if (row.hasChildren && !row.isCollapsed) onToggle(row.id, false);
        else {
          // Move to the parent row.
          for (let i = index - 1; i >= 0; i -= 1) {
            if (rows[i].depth < row.depth) {
              focusRow(i);
              break;
            }
          }
        }
        break;
      }
    }
  }

  const endMarkerX = projectEnd && projectEnd >= range.start && projectEnd <= range.end ? dateToX(range, addDays(projectEnd, 1), dayWidth) : null;
  const todayX = todayInRange ? dateToX(range, today, dayWidth) + dayWidth / 2 : null;
  const overrunBox = overrun ? barGeometry(range, overrun.start, overrun.end, dayWidth) : null;

  return (
    <div className="relative min-w-0">
      <p className="sr-only" aria-live="polite">
        {summary}
      </p>
      <div
        ref={scrollerRef}
        data-testid="gantt-scroller"
        className="relative max-h-[calc(100dvh-16rem)] min-h-80 overflow-auto overscroll-contain rounded-lg border border-border bg-surface [--gantt-left:10rem] sm:max-h-[calc(100dvh-14rem)] sm:[--gantt-left:16rem] lg:[--gantt-left:20rem]"
      >
        <div className="relative" style={{ width: `max(100%, calc(${timelineWidth}px + var(--gantt-left)))` }} data-gantt-canvas>
          {/* Header */}
          <div className="sticky top-0 z-20 flex border-b border-border bg-surface">
            <div
              className={cn(
                LEFT_COL,
                "sticky left-0 z-30 flex shrink-0 items-end border-r border-border bg-surface px-3 pb-1.5 text-xs leading-4 font-medium text-muted-foreground",
              )}
            >
              Work breakdown · {totalCount}
            </div>
            <div aria-hidden className="relative h-14 shrink-0" style={{ width: timelineWidth }}>
              {header.top.map((s) => (
                <div
                  key={s.key}
                  className="absolute top-0 flex h-7 items-center overflow-hidden border-l border-chart-gridline px-2 text-xs leading-4 font-semibold whitespace-nowrap text-foreground"
                  style={{ left: s.x, width: s.width }}
                >
                  {/* A partial month/year at the edge too narrow for its name stays blank (no clipped text). */}
                  {labelFits(s.label, s.width, 7.2, 16) ? (
                    <span className="sticky left-[calc(var(--gantt-left)+0.5rem)]">{s.label}</span>
                  ) : null}
                </div>
              ))}
              {header.bottom.map((s) => (
                <div
                  key={s.key}
                  className={cn(
                    "absolute top-7 flex h-7 items-center justify-center overflow-hidden border-l border-chart-gridline text-[11px] leading-4 whitespace-nowrap text-muted-foreground tabular-nums",
                    s.isNonWorking && "bg-chart-nonworking",
                    s.isToday && "font-semibold text-primary-text",
                  )}
                  style={{ left: s.x, width: s.width }}
                >
                  {labelFits(s.label, s.width, 6.4, 4) ? s.label : null}
                </div>
              ))}
              {todayX !== null ? (
                <span
                  className="absolute top-[30px] z-[1] -translate-x-1/2 rounded-full bg-chart-today px-1.5 text-[10px] leading-4 font-semibold text-primary-foreground"
                  style={{ left: todayX }}
                >
                  Today
                </span>
              ) : null}
              {endMarkerX !== null ? (
                <span
                  className="absolute top-[31px] z-[1] -translate-x-full rounded-full border border-chart-end-marker/50 bg-surface px-1.5 text-[10px] leading-3.5 font-semibold whitespace-nowrap text-chart-end-marker"
                  style={{ left: endMarkerX - 3 }}
                >
                  Planned end {formatDate(projectEnd)}
                </span>
              ) : null}
            </div>
          </div>

          {/* Body */}
          <div className="relative">
            {/* Background: non-working days, gridlines, overrun, planned end, today. */}
            <div aria-hidden className={cn("pointer-events-none absolute inset-y-0", LEFT_OFFSET)} style={{ width: timelineWidth }}>
              {showDayDetail
                ? nonWorking.map((run) => (
                    <div key={run.start} className="absolute inset-y-0 bg-chart-nonworking" style={{ left: run.x, width: run.width }} />
                  ))
                : null}
              {header.bottom.length <= 800
                ? header.bottom.map((s) => (
                    <div key={s.key} className="absolute inset-y-0 w-px bg-chart-gridline/70" style={{ left: s.x }} />
                  ))
                : null}
              {overrunBox ? (
                <div
                  data-testid="gantt-overrun"
                  className="absolute inset-y-0 bg-chart-overrun"
                  style={{ left: overrunBox.x, width: overrunBox.width }}
                />
              ) : null}
              {endMarkerX !== null ? (
                <div className="absolute inset-y-0 border-l-2 border-dashed border-chart-end-marker" style={{ left: endMarkerX - 1 }} />
              ) : null}
              {todayX !== null ? <div className="absolute inset-y-0 w-0.5 bg-chart-today" style={{ left: todayX - 1 }} /> : null}
            </div>

            <div role="tree" aria-label="Work breakdown on the timeline" className="relative">
              {rows.map((row, index) => (
                <GanttRowView
                  key={row.id}
                  row={row}
                  index={index}
                  range={range}
                  dayWidth={dayWidth}
                  timelineWidth={timelineWidth}
                  showBaseline={showBaseline}
                  showLabel={showDayDetail}
                  selected={row.id === selectedId}
                  tabbable={row.id === focusId}
                  onSelect={onSelect}
                  onToggle={onToggle}
                  onKeyDown={onRowKeyDown}
                  buttonRef={(el) => {
                    if (el) rowRefs.current.set(row.id, el);
                    else rowRefs.current.delete(row.id);
                  }}
                />
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

type GanttRowViewProps = {
  row: GanttRow;
  index: number;
  range: TimelineRange;
  dayWidth: number;
  timelineWidth: number;
  showBaseline: boolean;
  showLabel: boolean;
  selected: boolean;
  tabbable: boolean;
  onSelect: (id: string) => void;
  onToggle: (id: string, expand?: boolean) => void;
  onKeyDown: (event: React.KeyboardEvent<HTMLButtonElement>, index: number) => void;
  buttonRef: (el: HTMLButtonElement | null) => void;
};

const GanttRowView = React.memo(function GanttRowView({
  row,
  index,
  range,
  dayWidth,
  timelineWidth,
  showBaseline,
  showLabel,
  selected,
  tabbable,
  onSelect,
  onToggle,
  onKeyDown,
  buttonRef,
}: GanttRowViewProps) {
  const meta = STATUS_META[row.status];
  const StatusIcon = meta.icon;
  const tone = BAR_TONES[row.status];
  const scheduled = row.start !== null && row.end !== null;
  const statusText = row.delay.delayed ? `Delayed: ${row.delay.reason}` : meta.label;
  const dates = scheduled ? formatDateRange(row.start, row.end) : "Not scheduled";

  return (
    <div
      data-testid="gantt-row"
      data-row-id={row.id}
      className={cn("group/row relative flex h-9", selected && "bg-primary-soft/50")}
      onClick={() => onSelect(row.id)}
    >
      {/* WBS column */}
      <div
        className={cn(
          LEFT_COL,
          "sticky left-0 z-10 flex shrink-0 items-center gap-1 border-r border-b border-border bg-surface pr-2",
          "group-hover/row:bg-surface-muted",
          selected && "bg-primary-soft group-hover/row:bg-primary-soft",
        )}
        style={{ paddingLeft: 4 + row.depth * 14 }}
      >
        {row.hasChildren ? (
          <button
            type="button"
            tabIndex={-1}
            aria-label={row.isCollapsed ? `Expand ${row.wbsCode}` : `Collapse ${row.wbsCode}`}
            onClick={(event) => {
              event.stopPropagation();
              onToggle(row.id);
            }}
            className="grid size-7 shrink-0 place-items-center rounded-sm text-muted-foreground hover:bg-surface-sunken hover:text-foreground"
          >
            <ChevronRight aria-hidden className={cn("size-4 transition-transform duration-200 ease-in-out", !row.isCollapsed && "rotate-90")} />
          </button>
        ) : (
          <span aria-hidden className="size-7 shrink-0" />
        )}
        <button
          ref={buttonRef}
          type="button"
          role="treeitem"
          aria-level={row.level}
          aria-expanded={row.hasChildren ? !row.isCollapsed : undefined}
          aria-selected={selected}
          tabIndex={tabbable ? 0 : -1}
          onKeyDown={(event) => onKeyDown(event, index)}
          onClick={() => onSelect(row.id)}
          aria-label={`${row.wbsCode} ${row.name}. ${statusText}. ${dates}. ${formatPercent(row.percent)} complete.`}
          className="flex h-8 min-w-0 flex-1 items-center gap-2 rounded-sm px-1 text-left focus-ring"
        >
          <span className="hidden shrink-0 font-mono text-[11px] text-muted-foreground tabular-nums sm:inline">{row.wbsCode}</span>
          <TruncatedText className={cn("truncate text-[13px] leading-5", row.level === 1 ? "font-semibold" : row.level === 2 ? "font-medium" : "")}>
            {row.name}
          </TruncatedText>
        </button>
        <SimpleTooltip content={scheduled ? statusText : "Not scheduled: add a start date and duration in the Work Breakdown"} side="right">
          <span className={cn("inline-flex shrink-0", scheduled ? tone.text : "text-muted-foreground")}>
            <StatusIcon aria-hidden className="size-4" strokeWidth={2.25} />
            {row.containsDelayed ? <span aria-hidden className="-ml-1 size-1.5 self-start rounded-full bg-danger" /> : null}
          </span>
        </SimpleTooltip>
      </div>

      {/* Timeline */}
      <div className="relative shrink-0 border-b border-border/60" style={{ width: timelineWidth }}>
        {scheduled ? (
          <Bars row={row} range={range} dayWidth={dayWidth} showBaseline={showBaseline} showLabel={showLabel} dates={dates} statusText={statusText} />
        ) : null}
      </div>
    </div>
  );
});

function Bars({
  row,
  range,
  dayWidth,
  showBaseline,
  showLabel,
  dates,
  statusText,
}: {
  row: GanttRow;
  range: TimelineRange;
  dayWidth: number;
  showBaseline: boolean;
  showLabel: boolean;
  dates: string;
  statusText: string;
}) {
  const start = row.start as ISODate;
  const end = row.end as ISODate;
  const { x, width } = barGeometry(range, start, end, dayWidth);
  const tone = BAR_TONES[row.status];
  const baseline = showBaseline && row.baseline?.start && row.baseline.end ? barGeometry(range, row.baseline.start, row.baseline.end, dayWidth) : null;
  const tip = `${row.wbsCode} ${row.name} · ${dates} · ${statusText} · ${formatPercent(row.percent)}`;
  const labelX = (row.overdue ? dateToX(range, addDays(row.overdue.end, 1), dayWidth) : x + width) + 6;

  return (
    <>
      {baseline ? (
        <div
          aria-hidden
          data-testid="gantt-baseline-bar"
          className="absolute top-[28px] h-[4px] rounded-full bg-chart-baseline/80"
          style={{ left: baseline.x, width: baseline.width }}
        />
      ) : null}
      {row.isMilestone ? (
        <SimpleTooltip content={tip}>
          <div
            data-testid="gantt-milestone"
            className={cn("absolute top-[11px] size-3.5 rotate-45 rounded-[3px] border-[1.5px]", tone.bar, tone.fill)}
            style={{ left: x + dayWidth / 2 - 7 }}
          />
        </SimpleTooltip>
      ) : row.isLeaf ? (
        <SimpleTooltip content={tip}>
          <div
            data-testid="gantt-bar"
            data-status={row.status}
            className={cn("absolute top-[8px] h-5 overflow-hidden rounded-[5px] border-[1.5px]", tone.bar, row.overdue && "rounded-r-none")}
            style={{ left: x, width: Math.max(width, 4) }}
          >
            <div className={cn("h-full", tone.fill)} style={{ width: `${Math.min(100, Math.max(0, row.percent))}%` }} />
          </div>
        </SimpleTooltip>
      ) : (
        <SimpleTooltip content={tip}>
          <div data-testid="gantt-summary-bar" className="absolute top-[12px] h-3" style={{ left: x, width: Math.max(width, 4) }}>
            <div className="absolute inset-x-0 top-0 h-[7px] rounded-[2px] bg-chart-summary/25">
              <div className="h-full rounded-[2px] bg-chart-summary" style={{ width: `${Math.min(100, Math.max(0, row.percent))}%` }} />
            </div>
            <span className="absolute top-0 left-0 h-3 w-[3px] rounded-b-sm bg-chart-summary" />
            <span className="absolute top-0 right-0 h-3 w-[3px] rounded-b-sm bg-chart-summary" />
          </div>
        </SimpleTooltip>
      )}
      {row.overdue ? (
        <div
          aria-hidden
          data-testid="gantt-overdue"
          className={cn("absolute top-[8px] h-5 rounded-r-[5px]", OVERDUE_HATCH)}
          style={{ left: dateToX(range, row.overdue.start, dayWidth), width: barGeometry(range, row.overdue.start, row.overdue.end, dayWidth).width }}
        />
      ) : null}
      {showLabel ? (
        <span
          aria-hidden
          className="pointer-events-none absolute top-1/2 -translate-y-1/2 text-[11px] leading-4 whitespace-nowrap text-muted-foreground tabular-nums"
          style={{ left: labelX }}
        >
          {row.isMilestone ? row.name : formatPercent(row.percent)}
        </span>
      ) : null}
    </>
  );
}

/** Rough fit check for a header label (Poppins at the header sizes; average glyph widths). */
function labelFits(label: string, width: number, charWidth: number, padding: number): boolean {
  return label.length * charWidth + padding <= width;
}
