"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ChartGantt, ChevronsDownUp, ChevronsUpDown, CircleHelp, ListTree, LocateFixed } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Notice } from "@/components/wbs/notice";
import { useStoredChoice } from "@/components/wbs/use-stored-choice";
import {
  buildGanttRows,
  buildTree,
  createCalendarIndex,
  dateToX,
  fitDayWidth,
  formatDate,
  ganttSummary,
  isOpenProjectStatus,
  nonWorkingRuns,
  pluralize,
  projectOverrun,
  rollupTree,
  timelineHeader,
  timelineRange,
  ZOOM_DAY_WIDTH,
  type ActivityRecord,
  type BaselineDates,
  type DurationUnit,
  type GanttZoom,
  type ISODate,
  type ProgressWeighting,
  type ProjectStatus,
  type WorkingCalendar,
} from "@/lib/domain";
import { GanttChart } from "./gantt-chart";
import { GanttDetails } from "./gantt-details";
import { GanttLegend } from "./gantt-legend";

type ZoomChoice = GanttZoom | "fit";
const ZOOM_CHOICES: ReadonlyArray<ZoomChoice> = ["day", "week", "month", "quarter", "fit"];
const ZOOM_OPTIONS = [
  { value: "day", label: "Day" },
  { value: "week", label: "Week" },
  { value: "month", label: "Month" },
  { value: "quarter", label: "Quarter" },
  { value: "fit", label: "Fit" },
] as const satisfies ReadonlyArray<{ value: ZoomChoice; label: string }>;

/** Left WBS column width in px per breakpoint (matches the chart's w-40 / sm:w-64 / lg:w-80). */
function leftColumnPx(viewport: number): number {
  if (viewport >= 1024) return 320;
  if (viewport >= 640) return 256;
  return 160;
}

export type GanttActivity = ActivityRecord & { wbsCode: string; level: number };

export type GanttBaselineOption = { id: string; version: number; reason: string | null; isActive: boolean };

export type GanttViewProps = {
  project: {
    id: string;
    status: ProjectStatus;
    startDate: ISODate | null;
    endDate: ISODate | null;
    weighting: ProgressWeighting;
  };
  activities: GanttActivity[];
  calendar: WorkingCalendar;
  baselines: GanttBaselineOption[];
  /** Baseline shown when the overlay is on (from `?baseline=`, else the active one). */
  baselineId: string | null;
  baselineDates: Record<string, BaselineDates>;
  today: ISODate;
  durationUnit: DurationUnit;
  canEditWbs: boolean;
};

/** Read-only Gantt (Stage A, docs/ROADMAP.md §4.0): toolbar, notices, the chart and a details panel. */
export function GanttView({
  project,
  activities,
  calendar,
  baselines,
  baselineId,
  baselineDates,
  today,
  durationUnit,
  canEditWbs,
}: GanttViewProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [zoom, setZoom] = useStoredChoice<ZoomChoice>("civpms:gantt-zoom", ZOOM_CHOICES, "week");
  const [baselineToggle, setBaselineToggle] = useStoredChoice<"on" | "off">("civpms:gantt-baseline", ["on", "off"], "off");
  const [collapsed, setCollapsed] = React.useState<ReadonlySet<string>>(() => new Set());
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const [fitWidth, setFitWidth] = React.useState(0);
  const scrollerRef = React.useRef<HTMLDivElement>(null);
  const showBaseline = baselineToggle === "on" && baselineId !== null;

  const calendarIndex = React.useMemo(() => createCalendarIndex(calendar), [calendar]);
  const { roots } = React.useMemo(() => buildTree(activities), [activities]);
  const rollups = React.useMemo(() => rollupTree(roots, { weighting: project.weighting, today }), [roots, project.weighting, today]);
  const baselineMap = React.useMemo(() => new Map(Object.entries(baselineDates)), [baselineDates]);

  const allRows = React.useMemo(
    () => buildGanttRows({ roots, rollups, today, baseline: baselineMap, calendar: calendarIndex }),
    [roots, rollups, today, baselineMap, calendarIndex],
  );
  const rows = React.useMemo(
    () => (collapsed.size === 0 ? allRows : buildGanttRows({ roots, rollups, today, baseline: baselineMap, calendar: calendarIndex, collapsedIds: collapsed })),
    [allRows, collapsed, roots, rollups, today, baselineMap, calendarIndex],
  );

  const leaves = React.useMemo(() => allRows.filter((r) => r.isLeaf), [allRows]);
  const unscheduled = leaves.filter((r) => !r.start || !r.end).length;
  const delayedCount = leaves.filter((r) => r.delay.delayed).length;
  const parentIds = allRows.filter((r) => r.hasChildren).map((r) => r.id);
  const isOpen = isOpenProjectStatus(project.status);

  const range = React.useMemo(() => {
    const baselineValues = showBaseline ? [...baselineMap.values()] : [];
    return timelineRange({
      projectStart: project.startDate,
      projectEnd: project.endDate,
      datedStarts: [...leaves.map((r) => r.start), ...baselineValues.map((b) => b.start)],
      datedEnds: [...leaves.map((r) => r.overdue?.end ?? r.end), ...baselineValues.map((b) => b.end)],
      today,
      isOpen,
    });
  }, [leaves, showBaseline, baselineMap, project.startDate, project.endDate, today, isOpen]);

  // Width available to the timeline, measured for "Fit".
  React.useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const measure = () => setFitWidth(Math.max(0, el.clientWidth - leftColumnPx(window.innerWidth)));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const dayWidth = zoom === "fit" ? fitDayWidth(range.days, fitWidth) : ZOOM_DAY_WIDTH[zoom];
  const header = React.useMemo(() => timelineHeader(range, dayWidth, { today, calendar: calendarIndex }), [range, dayWidth, today, calendarIndex]);
  const nonWorking = React.useMemo(() => nonWorkingRuns(calendarIndex, range, dayWidth), [calendarIndex, range, dayWidth]);
  const overrun = projectOverrun({ status: project.status, endDate: project.endDate, today });

  const scrollToDate = React.useCallback(
    (date: ISODate, behavior: ScrollBehavior) => {
      const el = scrollerRef.current;
      if (!el) return;
      const visible = el.clientWidth - leftColumnPx(window.innerWidth);
      const target = dateToX(range, date, dayWidth) - visible / 3;
      el.scrollTo({ left: Math.max(0, target), behavior });
    },
    [range, dayWidth],
  );

  // Open near today (or the project start when today is outside the timeline); again after a zoom change.
  const anchor = today >= range.start && today <= range.end ? today : (project.startDate ?? range.start);
  React.useEffect(() => {
    scrollToDate(anchor, "auto");
  }, [scrollToDate, anchor]);

  const toggle = React.useCallback((id: string, expand?: boolean) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      const isCollapsed = next.has(id);
      if (expand === true || (expand === undefined && isCollapsed)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const selected = selectedId ? (allRows.find((r) => r.id === selectedId) ?? null) : null;
  const wbsHref = `/projects/${project.id}/wbs`;
  const activeBaseline = baselines.find((b) => b.id === baselineId) ?? null;

  const headerBlock = (
    <PageHeader
      title="Gantt Chart"
      description="Your work breakdown on the working calendar. Read-only for now."
      actions={
        <Button asChild variant={canEditWbs ? "primary" : "outline"}>
          <Link href={wbsHref}>
            <ListTree aria-hidden />
            {canEditWbs ? "Edit in Work Breakdown" : "Open Work Breakdown"}
          </Link>
        </Button>
      }
    />
  );

  if (activities.length === 0 || leaves.length === unscheduled) {
    const none = activities.length === 0;
    return (
      <div className="flex flex-col gap-6">
        {headerBlock}
        <EmptyState
          icon={<ChartGantt />}
          title={none ? "No work packages yet" : "Nothing is scheduled yet"}
          description={
            none
              ? "The chart is drawn from the Work Breakdown. Add deliverables and work packages there and they appear here as bars."
              : `Give the ${pluralize(leaves.length, "work package")} a start date and a duration in the Work Breakdown, and each one gets a bar on the timeline.`
          }
          action={
            <Button asChild>
              <Link href={wbsHref}>
                <ListTree aria-hidden />
                {canEditWbs ? "Plan in Work Breakdown" : "Open Work Breakdown"}
              </Link>
            </Button>
          }
        />
      </div>
    );
  }

  const summary = ganttSummary({
    activityCount: allRows.length,
    start: allRows.reduce<ISODate | null>((min, r) => (r.start && (!min || r.start < min) ? r.start : min), null),
    end: allRows.reduce<ISODate | null>((max, r) => (r.end && (!max || r.end > max) ? r.end : max), null),
    delayedCount,
    unscheduledCount: unscheduled,
  });

  return (
    <div className="flex flex-col gap-4">
      {headerBlock}

      {overrun ? (
        <Notice tone="danger" title={`This project is ${pluralize(overrun.days, "day")} past its planned end`} data-testid="gantt-overrun-notice">
          Planned end {formatDate(project.endDate)}. The shaded area on the timeline shows the overrun up to today.
        </Notice>
      ) : null}
      {unscheduled > 0 ? (
        <Notice
          tone="info"
          title={`${pluralize(unscheduled, "work package")} ${unscheduled === 1 ? "isn't" : "aren't"} scheduled yet`}
          action={
            <Button asChild variant="outline" size="sm">
              <Link href={wbsHref}>Schedule in Work Breakdown</Link>
            </Button>
          }
        >
          {unscheduled === 1 ? "It's" : "They're"} listed without a bar. Add a start date and a duration to place {unscheduled === 1 ? "it" : "them"} on the timeline.
        </Notice>
      ) : null}

      {/* Toolbar */}
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="-mx-4 -my-1 overflow-x-auto px-4 py-1 [scrollbar-width:none] sm:mx-0 sm:px-0 [&::-webkit-scrollbar]:hidden">
          <SegmentedControl aria-label="Zoom" options={ZOOM_OPTIONS} value={zoom} onValueChange={setZoom} size="sm" />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => scrollToDate(today, "smooth")} disabled={!(today >= range.start && today <= range.end)}>
            <LocateFixed aria-hidden />
            Today
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setCollapsed(new Set())} disabled={collapsed.size === 0}>
            <ChevronsUpDown aria-hidden />
            Expand all
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setCollapsed(new Set(parentIds))} disabled={parentIds.length === 0 || collapsed.size === parentIds.length}>
            <ChevronsDownUp aria-hidden />
            Collapse all
          </Button>
          {baselines.length > 0 ? (
            <div className="flex items-center gap-2 rounded-md border border-border px-2.5 py-1">
              <Switch
                size="sm"
                checked={baselineToggle === "on"}
                onCheckedChange={(on) => setBaselineToggle(on ? "on" : "off")}
                label={baselines.length === 1 && activeBaseline ? `Baseline v${activeBaseline.version}` : "Baseline"}
              />
              {baselines.length > 1 ? (
                <Select
                  value={baselineId ?? undefined}
                  onValueChange={(id) => {
                    const params = new URLSearchParams(searchParams.toString());
                    params.set("baseline", id);
                    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
                    setBaselineToggle("on");
                  }}
                >
                  <SelectTrigger aria-label="Baseline version" className="h-8 w-auto gap-1.5 px-2.5 text-[13px] sm:h-8">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent align="end">
                    {baselines.map((b) => (
                      <SelectItem key={b.id} value={b.id}>
                        v{b.version}
                        {b.isActive ? " · active" : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : null}
            </div>
          ) : null}
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="ghost" size="sm">
                <CircleHelp aria-hidden />
                Legend
              </Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-80">
              <GanttLegend />
            </PopoverContent>
          </Popover>
        </div>
      </div>

      <GanttChart
        rows={rows}
        range={range}
        dayWidth={dayWidth}
        header={header}
        nonWorking={nonWorking}
        today={today}
        projectEnd={project.endDate}
        overrun={overrun}
        showBaseline={showBaseline}
        selectedId={selectedId}
        onSelect={setSelectedId}
        onToggle={toggle}
        scrollerRef={scrollerRef}
        summary={summary}
        totalCount={allRows.length}
      />

      {selected ? (
        <GanttDetails
          row={selected}
          durationUnit={durationUnit}
          hoursPerDay={calendar.hoursPerDay}
          baselineVersion={showBaseline ? (activeBaseline?.version ?? null) : null}
          wbsHref={wbsHref}
          onClose={() => setSelectedId(null)}
        />
      ) : (
        <p className="text-[13px] leading-5 text-muted-foreground">
          Select a row or a bar to see its dates, cost and progress. Keyboard: ↑ ↓ to move, → ← to open or close a branch.
        </p>
      )}
    </div>
  );
}
