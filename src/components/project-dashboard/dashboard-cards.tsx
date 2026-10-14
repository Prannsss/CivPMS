import Link from "next/link";
import {
  CalendarClock,
  ChevronRight,
  CircleCheck,
  ClipboardCheck,
  Gauge,
  History,
  ListTree,
  OctagonAlert,
  Sparkles,
  TrendingUp,
  TriangleAlert,
  Wallet,
} from "lucide-react";
import { LogEntry } from "@/components/audit/log-entry";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Meter } from "@/components/ui/meter";
import { Progress } from "@/components/ui/progress";
import { StatCard } from "@/components/ui/stat-card";
import {
  budgetAllocation,
  diffDays,
  formatDate,
  formatPeso,
  formatPesoCompact,
  formatPercent,
  pluralize,
  type ISODate,
} from "@/lib/domain";
import { cn } from "@/lib/utils";
import type { AuditEntry } from "@/server/queries/audit";
import type { AttentionItem, AttentionTone } from "./attention";
import type { WorkSummary } from "./work-summary";

/**
 * Project dashboard building blocks (spec §9.4, adapted to Phase 1). Server components: the page
 * passes data in; nothing here fetches.
 */

export interface DashboardProject {
  id: string;
  name: string;
  status: string;
  startDate: ISODate;
  endDate: ISODate;
  budget: number;
  allocated: number;
  nearBudgetThreshold: number;
  isDelayed: boolean;
  budgetState: "ok" | "near" | "exceeded";
}

// ---------------------------------------------------------------------------
// Overdue banner (§5.4)
// ---------------------------------------------------------------------------

export function OverdueBanner({
  project,
  today,
  scheduleEnd,
  canManage,
}: {
  project: DashboardProject;
  today: ISODate;
  scheduleEnd: ISODate | null;
  canManage: boolean;
}) {
  if (!project.isDelayed) return null;
  const days = Math.max(1, diffDays(today, project.endDate));
  return (
    <section
      aria-labelledby="overdue-title"
      className="flex flex-col gap-4 rounded-lg border border-danger/30 bg-danger-soft p-4 sm:flex-row sm:items-center sm:gap-5 sm:p-5"
    >
      <span aria-hidden className="grid size-11 shrink-0 place-items-center rounded-full bg-surface text-danger-text shadow-xs">
        <TriangleAlert className="size-5" />
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <h2 id="overdue-title" className="text-[15px] leading-6 font-semibold text-danger-text">
          {pluralize(days, "day")} past the planned end date
        </h2>
        <p className="text-sm leading-[1.375rem] text-foreground">
          Planned to finish on <span className="font-medium tabular-nums">{formatDate(project.endDate)}</span>
          {scheduleEnd && scheduleEnd > project.endDate ? (
            <>
              ; scheduled work now runs until <span className="font-medium tabular-nums">{formatDate(scheduleEnd)}</span>
            </>
          ) : null}
          . Everything stays visible; the end date only changes when a PM edits it.
        </p>
      </div>
      {canManage ? (
        <Button variant="outline" asChild className="w-full sm:w-auto">
          <Link href={`/projects/${project.id}/settings#details`}>
            <CalendarClock aria-hidden />
            Review end date
          </Link>
        </Button>
      ) : null}
    </section>
  );
}

// ---------------------------------------------------------------------------
// KPI row
// ---------------------------------------------------------------------------

/** Two KPI tiles per row on phones: drop the icon tile and tighten padding so labels fit. */
const KPI_CLASS = "max-sm:gap-2 max-sm:p-4 max-sm:[&>div:first-child>span:last-child]:hidden";

export function DashboardKpis({ project, work }: { project: DashboardProject; work: WorkSummary }) {
  const budget = budgetAllocation(project.budget, project.allocated, project.nearBudgetThreshold);
  const budgetPct = Number.isFinite(budget.ratio) ? Math.round(budget.ratio * 100) : null;
  const budgetTone = budget.state === "exceeded" ? "danger" : budget.state === "near" ? "warning" : "primary";
  const unscheduled = work.unscheduled.length;
  const delayed = work.delayed.length;
  const firstDelayed = work.delayed[0];

  return (
    <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
      <StatCard
        className={KPI_CLASS}
        label="Overall progress"
        value={formatPercent(work.percent, { decimals: 1 })}
        icon={<TrendingUp />}
        tone={work.percent >= 100 ? "success" : "primary"}
        hint={
          work.leafCount > 0
            ? `${work.completedLeafCount} of ${pluralize(work.leafCount, "work package")} completed`
            : "No work packages yet"
        }
        footer={<Progress value={work.percent} size="sm" aria-label="Overall progress" />}
      />
      <StatCard
        className={KPI_CLASS}
        label="Budget allocated"
        value={formatPesoCompact(budget.allocated)}
        icon={budget.state === "near" ? <Gauge /> : budget.state === "exceeded" ? <OctagonAlert /> : <Wallet />}
        tone={budgetTone}
        hint={
          <>
            {budgetPct === null ? "—" : `${budgetPct}%`} of {formatPesoCompact(budget.budget)}
            {budget.state === "exceeded" ? (
              <span className="font-medium whitespace-nowrap text-danger-text"> · {formatPesoCompact(-budget.remaining)} over</span>
            ) : budget.state === "near" ? (
              <span className="font-medium whitespace-nowrap text-warning-text"> · near limit</span>
            ) : null}
          </>
        }
      />
      <StatCard
        className={KPI_CLASS}
        label="Activities"
        value={work.activityCount.toLocaleString("en-US")}
        icon={<ListTree />}
        tone={unscheduled > 0 ? "warning" : "info"}
        hint={
          work.activityCount === 0
            ? "Add the work breakdown to start tracking"
            : unscheduled > 0
              ? `${pluralize(unscheduled, "work package")} not scheduled yet`
              : `${pluralize(work.leafCount, "work package")}, all scheduled`
        }
      />
      <StatCard
        className={KPI_CLASS}
        label="Delayed activities"
        value={delayed.toLocaleString("en-US")}
        icon={delayed > 0 ? <TriangleAlert /> : <CircleCheck />}
        tone={delayed > 0 ? "danger" : "success"}
        hint={
          firstDelayed ? (
            <span className="line-clamp-2">
              {delayed > 1 ? "Most overdue: " : ""}
              <span className="font-mono tabular-nums">{firstDelayed.wbsCode}</span> {firstDelayed.name}
            </span>
          ) : (
            "Nothing is running late"
          )
        }
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Needs attention
// ---------------------------------------------------------------------------

const toneIcon: Record<AttentionTone, string> = {
  danger: "bg-danger-soft text-danger-text",
  warning: "bg-warning-soft text-warning-text",
  neutral: "bg-neutral-soft text-neutral-text",
  primary: "bg-primary-soft text-primary-text",
};

function AttentionIcon({ item }: { item: AttentionItem }) {
  const Icon =
    item.kind === "project_overdue" || item.kind === "delayed_activity" || item.kind === "delayed_more"
      ? TriangleAlert
      : item.kind === "budget_exceeded"
        ? OctagonAlert
        : item.kind === "budget_near"
          ? Gauge
          : item.kind === "projected_late"
            ? CalendarClock
            : item.kind === "empty_wbs"
              ? Sparkles
              : ListTree;
  return (
    <span aria-hidden className={cn("grid size-9 shrink-0 place-items-center rounded-md [&_svg]:size-[18px]", toneIcon[item.tone])}>
      <Icon />
    </span>
  );
}

const toneLabel: Record<AttentionTone, string> = {
  danger: "Urgent",
  warning: "Warning",
  neutral: "To do",
  primary: "Next step",
};

function AttentionRow({ item }: { item: AttentionItem }) {
  const body = (
    <>
      <AttentionIcon item={item} />
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="flex min-w-0 items-baseline gap-2 text-sm leading-5 font-medium text-foreground">
          <span className="sr-only">{toneLabel[item.tone]}: </span>
          {item.wbsCode ? (
            <span className="shrink-0 font-mono text-xs text-muted-foreground tabular-nums">{item.wbsCode}</span>
          ) : null}
          <span className="min-w-0 break-words">{item.title}</span>
        </span>
        <span className="text-[13px] leading-5 text-pretty text-muted-foreground">{item.detail}</span>
      </span>
      {item.href ? (
        <ChevronRight
          aria-hidden
          className="mt-2 size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5"
        />
      ) : null}
    </>
  );
  return (
    <li>
      {item.href ? (
        <Link
          href={item.href}
          className="group -mx-2 flex items-start gap-3 rounded-md px-2 py-2.5 transition-colors hover:bg-surface-muted focus-ring"
        >
          {body}
        </Link>
      ) : (
        <div className="-mx-2 flex items-start gap-3 px-2 py-2.5">{body}</div>
      )}
    </li>
  );
}

export function AttentionCard({ items, projectId }: { items: AttentionItem[]; projectId: string }) {
  const urgent = items.filter((item) => item.tone === "danger").length;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Needs attention</CardTitle>
        <CardDescription>
          {items.length === 0
            ? "Late work, budget warnings and unplanned work show up here."
            : urgent > 0
              ? `${pluralize(urgent, "urgent item")} · most urgent first`
              : `${pluralize(items.length, "item")} to look at`}
        </CardDescription>
        {items.length > 0 ? (
          <CardAction>
            <Badge tone={urgent > 0 ? "danger" : "warning"} size="md" className="tabular-nums">
              {items.length}
            </Badge>
          </CardAction>
        ) : null}
      </CardHeader>
      <CardContent className="pt-2 pb-3 sm:pt-2">
        {items.length === 0 ? (
          <EmptyState
            variant="plain"
            size="sm"
            headingLevel="h4"
            icon={<CircleCheck />}
            title="All clear"
            description="Nothing is late, over budget or missing dates right now."
          />
        ) : (
          <ul className="flex flex-col divide-y divide-border">
            {items.map((item) => (
              <AttentionRow key={item.id} item={item} />
            ))}
          </ul>
        )}
      </CardContent>
      {items.length > 0 ? (
        <CardFooter className="justify-end">
          <Button variant="link" size="sm" asChild>
            <Link href={`/projects/${projectId}/wbs`}>
              Open work breakdown
              <ChevronRight aria-hidden />
            </Link>
          </Button>
        </CardFooter>
      ) : null}
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Recent activity
// ---------------------------------------------------------------------------

export function RecentActivityCard({ entries, projectId, now }: { entries: AuditEntry[]; projectId: string; now: string }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Recent activity</CardTitle>
        <CardDescription>The latest changes from the audit trail</CardDescription>
      </CardHeader>
      <CardContent className="pt-3 sm:pt-3">
        {entries.length === 0 ? (
          <EmptyState
            variant="plain"
            size="sm"
            headingLevel="h4"
            icon={<History />}
            title="No changes yet"
            description="Edits, status changes and new team members will be listed here as they happen."
          />
        ) : (
          <ol className="flex flex-col gap-4">
            {entries.map((entry) => (
              <li key={entry.id}>
                <LogEntry entry={entry} projectId={projectId} now={now} compact />
              </li>
            ))}
          </ol>
        )}
      </CardContent>
      <CardFooter className="justify-end">
        <Button variant="link" size="sm" asChild>
          <Link href={`/projects/${projectId}/audit`}>
            Open audit trail
            <ChevronRight aria-hidden />
          </Link>
        </Button>
      </CardFooter>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Budget
// ---------------------------------------------------------------------------

export function BudgetCard({ project }: { project: DashboardProject }) {
  const budget = budgetAllocation(project.budget, project.allocated, project.nearBudgetThreshold);
  const over = budget.remaining < 0;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Budget</CardTitle>
        <CardDescription>Estimated cost of all work packages against the project budget</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        <Meter
          allocated={budget.allocated}
          budget={budget.budget}
          threshold={project.nearBudgetThreshold}
          label="Allocated"
          hideSummary
        />
        <dl className="grid grid-cols-1 gap-3 text-sm">
          <div className="flex items-baseline justify-between gap-3">
            <dt className="text-muted-foreground">Budget</dt>
            <dd className="font-medium text-foreground tabular-nums">{formatPeso(budget.budget)}</dd>
          </div>
          <div className="flex items-baseline justify-between gap-3">
            <dt className="text-muted-foreground">Allocated</dt>
            <dd className="font-medium text-foreground tabular-nums">{formatPeso(budget.allocated)}</dd>
          </div>
          <div className="flex items-baseline justify-between gap-3 border-t border-border pt-3">
            <dt className={cn("font-medium", over ? "text-danger-text" : "text-foreground")}>
              {over ? "Over budget by" : "Remaining"}
            </dt>
            <dd className={cn("font-semibold tabular-nums", over ? "text-danger-text" : "text-foreground")}>
              {formatPeso(Math.abs(budget.remaining))}
            </dd>
          </div>
        </dl>
        <p className="text-xs leading-4 text-muted-foreground">
          The Near Budget Limit warning starts at {Math.round(project.nearBudgetThreshold * 100)}% of the budget.
        </p>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Schedule (timeline with the overrun of §5.4)
// ---------------------------------------------------------------------------

function pct(value: number, total: number): number {
  return total <= 0 ? 0 : Math.min(100, Math.max(0, (value / total) * 100));
}

export function ScheduleCard({ project, work }: { project: DashboardProject; work: WorkSummary }) {
  const today = work.today;
  const closed = project.status === "completed" || project.status === "cancelled";
  const scheduleEnd = work.scheduleEnd;
  const axisEnd = [project.endDate, scheduleEnd, closed ? null : today]
    .filter((d): d is string => Boolean(d))
    .reduce((max, d) => (d > max ? d : max), project.endDate);
  const total = Math.max(1, diffDays(axisEnd, project.startDate));
  const endPct = pct(diffDays(project.endDate, project.startDate), total);
  const todayPct = pct(diffDays(today, project.startDate), total);
  const overrun = axisEnd > project.endDate;
  const totalDays = diffDays(project.endDate, project.startDate) + 1;

  let status: string;
  if (closed) status = `${project.status === "completed" ? "Completed" : "Cancelled"} · planned ${pluralize(totalDays, "day")}`;
  else if (today < project.startDate) status = `Starts in ${pluralize(diffDays(project.startDate, today), "day")}`;
  else if (today > project.endDate) status = `${pluralize(diffDays(today, project.endDate), "day")} overdue`;
  else {
    const elapsed = diffDays(today, project.startDate) + 1;
    const left = diffDays(project.endDate, today);
    status = `Day ${elapsed} of ${totalDays} · ${pluralize(left, "day")} left`;
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Schedule</CardTitle>
        <CardDescription className={cn(project.isDelayed && "font-medium text-danger-text")}>{status}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="flex flex-col gap-2" aria-hidden>
          <div className="relative h-3 w-full overflow-hidden rounded-full bg-surface-sunken dark:bg-border">
            <div
              className="absolute inset-y-0 left-0 rounded-full bg-primary"
              style={{ width: `${closed ? endPct : Math.min(todayPct, endPct)}%` }}
            />
            {overrun ? (
              <div
                className="absolute inset-y-0 right-0 bg-danger-soft [background-image:repeating-linear-gradient(135deg,var(--color-danger)_0_2px,transparent_2px_7px)] opacity-80"
                style={{ left: `${endPct}%` }}
              />
            ) : null}
            {overrun ? <div className="absolute inset-y-0 w-0.5 bg-foreground" style={{ left: `calc(${endPct}% - 1px)` }} /> : null}
          </div>
          {!closed && today >= project.startDate ? (
            <div className="relative h-4">
              <span
                className="absolute -translate-x-1/2 text-[11px] leading-4 font-semibold whitespace-nowrap text-foreground"
                style={{ left: `clamp(1.25rem, ${todayPct}%, calc(100% - 1.25rem))` }}
              >
                ▲ Today
              </span>
            </div>
          ) : null}
        </div>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
          <div className="flex flex-col gap-0.5">
            <dt className="text-xs text-muted-foreground">Planned start</dt>
            <dd className="font-medium text-foreground tabular-nums">{formatDate(project.startDate)}</dd>
          </div>
          <div className="flex flex-col gap-0.5">
            <dt className="text-xs text-muted-foreground">Planned end</dt>
            <dd className={cn("font-medium tabular-nums", project.isDelayed ? "text-danger-text" : "text-foreground")}>
              {formatDate(project.endDate)}
            </dd>
          </div>
          <div className="flex flex-col gap-0.5">
            <dt className="text-xs text-muted-foreground">Work scheduled from</dt>
            <dd className="font-medium text-foreground tabular-nums">{formatDate(work.scheduleStart)}</dd>
          </div>
          <div className="flex flex-col gap-0.5">
            <dt className="text-xs text-muted-foreground">Work scheduled until</dt>
            <dd
              className={cn(
                "font-medium tabular-nums",
                scheduleEnd && scheduleEnd > project.endDate ? "text-warning-text" : "text-foreground",
              )}
            >
              {formatDate(scheduleEnd)}
            </dd>
          </div>
        </dl>
        {!closed && (today >= project.startDate || overrun) ? (
          <ul className="flex flex-wrap gap-x-4 gap-y-1.5 text-xs leading-4 text-muted-foreground">
            <li className="flex items-center gap-1.5">
              <span aria-hidden className="h-2.5 w-4 shrink-0 rounded-xs bg-primary" />
              Time elapsed
            </li>
            {overrun ? (
              <li className="flex items-center gap-1.5">
                <span aria-hidden className="h-2.5 w-4 shrink-0 rounded-xs bg-danger-soft [background-image:repeating-linear-gradient(135deg,var(--color-danger)_0_2px,transparent_2px_7px)]" />
                Past the planned end date
              </li>
            ) : null}
          </ul>
        ) : null}
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Inspections (Phase 3)
// ---------------------------------------------------------------------------

export function InspectionsComingCard() {
  return (
    <Card variant="muted">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ClipboardCheck aria-hidden className="size-[18px] text-muted-foreground" />
          Site inspections
        </CardTitle>
        <CardDescription>Propose, approve and track inspections for this project.</CardDescription>
        <CardAction>
          <Badge tone="neutral" variant="outline" size="sm">
            Coming next
          </Badge>
        </CardAction>
      </CardHeader>
      <CardContent className="pt-3 sm:pt-3">
        <p className="text-[13px] leading-5 text-muted-foreground">
          Upcoming inspections and approvals will appear here in a later release.
        </p>
      </CardContent>
    </Card>
  );
}
