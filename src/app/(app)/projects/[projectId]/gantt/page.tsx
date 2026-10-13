import type { Metadata } from "next";
import Link from "next/link";
import {
  CalendarCheck,
  CalendarDays,
  GitCompareArrows,
  ListChecks,
  ListTree,
  Route,
  TriangleAlert,
  ZoomIn,
} from "lucide-react";
import { ComingNext, ReadinessPanel, type ComingNextFeature } from "@/components/coming-next/coming-next";
import { GanttPreview } from "@/components/coming-next/gantt-preview";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { pluralize } from "@/lib/domain/format";
import { getProjectAccess } from "@/server/context";

export const metadata: Metadata = { title: "Gantt Chart" };

const FEATURES: ComingNextFeature[] = [
  {
    icon: <ListTree />,
    title: "Rows follow your WBS",
    description: "Deliverables collapse into summary bars with a progress fill.",
  },
  {
    icon: <ZoomIn />,
    title: "Zoom from days to quarters",
    description: "Day, Week, Month and Quarter views, plus fit to project.",
  },
  {
    icon: <CalendarDays />,
    title: "Your working calendar",
    description: "A today line, with weekends and holidays shaded.",
  },
  {
    icon: <TriangleAlert />,
    title: "Delays you can't miss",
    description: "Status colors with icons, and overdue work extends to today.",
  },
  {
    icon: <GitCompareArrows />,
    title: "Baseline comparison",
    description: "Show Baseline v1 bars against the current plan.",
  },
  {
    icon: <Route />,
    title: "Dependencies and critical path",
    description: "Link activities and see which ones set the finish date.",
  },
];

/** Gantt chart (spec §9.1) arrives in Phase 2; until then this page explains it (CLAUDE.md). */
export default async function GanttPage({ params }: PageProps<"/projects/[projectId]/gantt">) {
  const { projectId } = await params;
  const { project, permissions } = await getProjectAccess(projectId);
  const leaves = project.leaf_count;
  const scheduled = Math.max(0, leaves - project.unscheduled_count);
  const scheduledPct = leaves > 0 ? Math.round((scheduled / leaves) * 100) : 0;

  return (
    <ComingNext
      title="Gantt Chart"
      description="See the whole schedule on a timeline."
      phase="Phase 2 · Scheduling"
      headline="Every activity on one timeline"
      lead="The Gantt chart is drawn straight from your Work Breakdown and working calendar. Nothing extra to enter: when it ships, your plan is already here."
      preview={<GanttPreview />}
      previewLabel="Preview of the Gantt chart: activities as colored bars on a monthly timeline, grouped by deliverable, with a today line."
      features={FEATURES}
      readiness={
        <ReadinessPanel
          items={[
            {
              icon: leaves > 0 && scheduled === leaves ? <CalendarCheck /> : <ListChecks />,
              state: leaves > 0 && scheduled === leaves ? "done" : "todo",
              title:
                leaves === 0
                  ? "No work packages yet"
                  : `${scheduled} of ${pluralize(leaves, "work package")} scheduled`,
              description:
                leaves === 0
                  ? "Add deliverables and work packages in Work Breakdown. They appear on the chart automatically."
                  : scheduled === leaves
                    ? "Every work package has a start date, duration and cost."
                    : "Give the rest a start date, duration and cost so they get a bar.",
              extra:
                leaves > 0 ? (
                  <Progress value={scheduledPct} size="sm" className="mt-1 max-w-56" aria-label="Work packages scheduled" />
                ) : null,
            },
            {
              icon: <CalendarDays />,
              state: "done",
              title: "Working calendar in place",
              description: "Working days, hours per day and Philippine holidays already set the bar lengths.",
            },
          ]}
          actions={
            <>
              <Button asChild>
                <Link href={`/projects/${project.id}/wbs`}>
                  <ListTree aria-hidden />
                  {permissions.canEditWbs ? "Plan in Work Breakdown" : "Open Work Breakdown"}
                </Link>
              </Button>
              <Button variant="outline" asChild>
                <Link href={`/projects/${project.id}/calendar`}>
                  <CalendarDays aria-hidden />
                  Check the calendar
                </Link>
              </Button>
            </>
          }
        />
      }
    />
  );
}
