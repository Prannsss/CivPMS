"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { CalendarCheck2, ChartLine, ChartSpline, Flag, Settings, TrendingUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { StatCard } from "@/components/ui/stat-card";
import { Notice } from "@/components/wbs/notice";
import { useStoredChoice } from "@/components/wbs/use-stored-choice";
import {
  createCalendarIndex,
  formatDate,
  formatDuration,
  formatPercent,
  formatPeso,
  formatPesoCompact,
  isOpenProjectStatus,
  maxISO,
  minISO,
  plannedCumulative,
  plannedPercentAt,
  pluralize,
  projectOverrun,
  scurveRange,
  weeklyRows,
  type DurationUnit,
  type ISODate,
  type ProgressWeighting,
  type ProjectStatus,
  type SCurveLeaf,
  type WorkingCalendar,
} from "@/lib/domain";
import { SCurveChart } from "./scurve-chart";

export type SCurveBaselineOption = { id: string; version: number; isActive: boolean };

export type SCurveViewProps = {
  project: {
    id: string;
    status: ProjectStatus;
    startDate: ISODate | null;
    endDate: ISODate | null;
    weighting: ProgressWeighting;
  };
  baselines: SCurveBaselineOption[];
  baselineId: string | null;
  /** Work packages of the shown baseline. */
  baselineLeaves: SCurveLeaf[];
  calendar: WorkingCalendar;
  today: ISODate;
  durationUnit: DurationUnit;
  /** Current work packages that are not in the shown baseline (scope added since). */
  notInBaseline: number;
  canEditProject: boolean;
};

/** S-curve, Stage A (docs/ROADMAP.md §4.0): the planned line from a baseline; no actual line yet. */
export function SCurveView({
  project,
  baselines,
  baselineId,
  baselineLeaves,
  calendar,
  today,
  durationUnit,
  notInBaseline,
  canEditProject,
}: SCurveViewProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [basis, setBasis] = useStoredChoice<ProgressWeighting>("civpms:scurve-basis", ["cost", "hours"], project.weighting);
  const [mode, setMode] = useStoredChoice<"chart" | "table">("civpms:scurve-view", ["chart", "table"], "chart");
  const calendarIndex = React.useMemo(() => createCalendarIndex(calendar), [calendar]);
  const baseline = baselines.find((b) => b.id === baselineId) ?? null;
  const isOpen = isOpenProjectStatus(project.status);

  const range = React.useMemo(() => {
    const starts = baselineLeaves.map((l) => l.start);
    const ends = baselineLeaves.map((l) => l.end);
    return scurveRange({
      projectStart: project.startDate,
      projectEnd: project.endDate,
      baselineStart: minISO(...starts),
      baselineEnd: maxISO(...ends),
      today,
      isOpen,
    });
  }, [baselineLeaves, project.startDate, project.endDate, today, isOpen]);

  const curve = React.useMemo(
    () => plannedCumulative({ leaves: baselineLeaves, basis, calendar: calendarIndex, range }),
    [baselineLeaves, basis, calendarIndex, range],
  );
  const overrun = projectOverrun({ status: project.status, endDate: project.endDate, today });

  const formatValue = React.useCallback(
    (value: number) => (basis === "cost" ? formatPeso(value) : formatDuration(value, durationUnit, calendar.hoursPerDay)),
    [basis, durationUnit, calendar.hoursPerDay],
  );
  const formatValueShort = React.useCallback(
    (value: number) =>
      basis === "cost" ? formatPesoCompact(value) : formatDuration(Math.round(value), durationUnit, calendar.hoursPerDay),
    [basis, durationUnit, calendar.hoursPerDay],
  );

  const header = (
    <PageHeader
      title="S-Curve"
      description="Cumulative planned progress over time, from the baseline. The actual line joins it once progress updates are recorded."
    />
  );

  if (!baseline) {
    return (
      <div className="flex flex-col gap-6">
        {header}
        <EmptyState
          icon={<ChartSpline />}
          title="No baseline yet"
          description="The planned curve is drawn from the baseline, a frozen copy of the plan taken when the project becomes Active. Finish planning in the Work Breakdown, then set the project to Active."
          action={
            canEditProject ? (
              <Button asChild>
                <Link href={`/projects/${project.id}/settings`}>
                  <Settings aria-hidden />
                  Open Project Settings
                </Link>
              </Button>
            ) : undefined
          }
        />
      </div>
    );
  }

  if (curve.datedCount === 0) {
    return (
      <div className="flex flex-col gap-6">
        {header}
        <EmptyState
          icon={<ChartSpline />}
          title={`Baseline v${baseline.version} has no scheduled work`}
          description="None of its work packages had a start date and a duration when it was taken, so there is nothing to draw."
        />
      </div>
    );
  }

  const todayPct = plannedPercentAt(curve, today);
  const todayValue = (todayPct / 100) * curve.total;
  const baselineLabel = `Baseline v${baseline.version}`;

  return (
    <div className="flex flex-col gap-5">
      {header}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Planned by today"
          value={formatPercent(todayPct, { decimals: 1 })}
          icon={<TrendingUp />}
          hint={curve.total > 0 ? `${formatValue(todayValue)} of ${formatValue(curve.total)}` : undefined}
          data-testid="scurve-kpi-planned"
        />
        <StatCard label="Actual by today" value="—" icon={<ChartLine />} tone="neutral" hint="No progress recorded yet" />
        <StatCard
          label="Baseline finish"
          value={curve.finish ? formatDate(curve.finish) : "—"}
          icon={<CalendarCheck2 />}
          tone="success"
          hint={project.endDate ? `Planned end ${formatDate(project.endDate)}` : undefined}
        />
        <StatCard
          label="Baseline"
          value={`v${baseline.version}`}
          icon={<Flag />}
          tone="neutral"
          hint={`${pluralize(curve.datedCount, "work package")}${baseline.isActive ? " · active" : ""}`}
        />
      </div>

      <Notice tone="info" title="No progress recorded yet" data-testid="scurve-no-progress">
        The actual line appears here once progress updates are recorded (they arrive with field updates). Until then the
        chart shows the plan only.
      </Notice>
      {overrun ? (
        <Notice tone="danger" title={`This project is ${pluralize(overrun.days, "day")} past its planned end`}>
          Planned end {formatDate(project.endDate)}. The shaded area shows the overrun up to today.
        </Notice>
      ) : null}
      {curve.undatedCount > 0 || notInBaseline > 0 ? (
        <Notice tone="warning" title="Some work is not on this curve">
          {[
            curve.undatedCount > 0 ? `${pluralize(curve.undatedCount, "work package")} had no dates in ${baselineLabel}` : null,
            notInBaseline > 0 ? `${pluralize(notInBaseline, "work package")} ${notInBaseline === 1 ? "was" : "were"} added after it` : null,
          ]
            .filter(Boolean)
            .join("; ")}
          . A new baseline (coming with scheduling) will include them.
        </Notice>
      ) : null}

      <section aria-labelledby="scurve-chart-title" className="flex flex-col gap-4 rounded-lg border border-border bg-surface p-4 sm:p-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <h2 id="scurve-chart-title" className="text-h3">
            Planned progress
          </h2>
          <div className="flex flex-wrap items-center gap-2">
            <SegmentedControl
              aria-label="Weight by"
              size="sm"
              options={[
                { value: "cost", label: "Cost" },
                { value: "hours", label: "Hours" },
              ]}
              value={basis}
              onValueChange={setBasis}
            />
            <SegmentedControl
              aria-label="Show as"
              size="sm"
              options={[
                { value: "chart", label: "Chart" },
                { value: "table", label: "Table" },
              ]}
              value={mode}
              onValueChange={setMode}
            />
            {baselines.length > 1 ? (
              <Select
                value={baseline.id}
                onValueChange={(id) => {
                  const params = new URLSearchParams(searchParams.toString());
                  params.set("baseline", id);
                  router.replace(`${pathname}?${params.toString()}`, { scroll: false });
                }}
              >
                <SelectTrigger aria-label="Baseline version" className="h-8 w-auto gap-1.5 px-2.5 text-[13px] sm:h-8">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent align="end">
                  {baselines.map((b) => (
                    <SelectItem key={b.id} value={b.id}>
                      Baseline v{b.version}
                      {b.isActive ? " · active" : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : null}
          </div>
        </div>

        {mode === "chart" ? (
          <SCurveChart
            points={curve.points}
            today={today}
            projectEnd={project.endDate}
            overrun={overrun}
            formatValue={curve.total > 0 ? formatValue : null}
            formatValueShort={curve.total > 0 ? formatValueShort : null}
            total={curve.total}
            baselineLabel={baselineLabel}
          />
        ) : (
          <div className="max-h-[28rem] overflow-auto rounded-md border border-border">
            <table className="w-full text-sm" data-testid="scurve-table">
              <caption className="sr-only">Planned cumulative progress by week, {baselineLabel}</caption>
              <thead className="sticky top-0 bg-surface-muted text-left text-xs text-muted-foreground">
                <tr>
                  <th scope="col" className="px-3 py-2 font-medium">Week of</th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">Planned</th>
                  {curve.total > 0 ? <th scope="col" className="px-3 py-2 text-right font-medium">Planned {basis === "cost" ? "cost" : "hours"}</th> : null}
                  <th scope="col" className="px-3 py-2 text-right font-medium">Actual</th>
                </tr>
              </thead>
              <tbody>
                {weeklyRows(curve.points).map((p) => (
                  <tr key={p.date} className="border-t border-border">
                    <td className="px-3 py-2 tabular-nums">{formatDate(p.date)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{formatPercent(p.percent, { decimals: 1 })}</td>
                    {curve.total > 0 ? <td className="px-3 py-2 text-right tabular-nums">{formatValue(p.value)}</td> : null}
                    <td className="px-3 py-2 text-right text-muted-foreground">—</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <p className="text-xs leading-4 text-muted-foreground">
          Each work package&apos;s {basis === "cost" ? "estimated cost" : "working hours"} is spread evenly over its working
          days in {baselineLabel}, using the project&apos;s current working calendar.
          {curve.usedFallbackWeight ? " Some work packages had no " + (basis === "cost" ? "cost" : "hours") + ", so the other basis or equal weight was used." : ""}
        </p>
      </section>
    </div>
  );
}
