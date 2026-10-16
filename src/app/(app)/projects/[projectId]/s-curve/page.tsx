import type { Metadata } from "next";
import Link from "next/link";
import {
  CalendarClock,
  ClipboardList,
  Coins,
  Crosshair,
  Flag,
  LayoutDashboard,
  ListTree,
  TrendingUp,
} from "lucide-react";
import { ComingNext, ReadinessPanel, type ComingNextFeature } from "@/components/coming-next/coming-next";
import { SCurvePreview } from "@/components/coming-next/s-curve-preview";
import { Button } from "@/components/ui/button";
import { getProjectAccess } from "@/server/context";

export const metadata: Metadata = { title: "S-Curve" };

const FEATURES: ComingNextFeature[] = [
  {
    icon: <TrendingUp />,
    title: "Planned vs actual",
    description: "Planned from the active baseline, actual rebuilt from progress updates.",
  },
  {
    icon: <Coins />,
    title: "Cost or hours",
    description: "Switch the basis, with a second axis in pesos or hours.",
  },
  {
    icon: <Crosshair />,
    title: "Variance on hover",
    description: "Planned %, actual % and the gap in points and pesos, for any date.",
  },
  {
    icon: <CalendarClock />,
    title: "Delays stay visible",
    description: "The axis runs past the end date, with the original finish marked.",
  },
];

/** S-curve (spec §9.2) arrives in Phase 3 with progress updates; until then this page explains it. */
export default async function SCurvePage({ params }: PageProps<"/projects/[projectId]/s-curve">) {
  const { projectId } = await params;
  const { project } = await getProjectAccess(projectId);
  const hasBaseline = project.status !== "planning";

  return (
    <ComingNext
      title="S-Curve"
      description="Track progress against the plan over time."
      phase="Phase 3 · Field and tracking"
      headline="Are we ahead or behind?"
      lead="The S-curve compares the cumulative progress you planned with what was actually done, weighted by cost or hours, so slippage shows up early."
      preview={<SCurvePreview />}
      previewLabel="Preview of the S-curve: a dashed planned line and a solid actual line rising over time, with the actual line below plan at today."
      features={FEATURES}
      readiness={
        <ReadinessPanel
          items={[
            {
              icon: <Flag />,
              state: hasBaseline ? "done" : "todo",
              title: hasBaseline ? "Baseline v1 is in place" : "No baseline yet",
              description: hasBaseline
                ? "It was captured when the project became Active. The planned line will come from it."
                : "Baseline v1 is captured automatically when the project moves from Planning to Active.",
            },
            {
              icon: <ClipboardList />,
              state: "todo",
              title: "Waiting for progress updates",
              description: "The actual line starts with the first progress update, which arrives in a later phase.",
            },
          ]}
          actions={
            <>
              <Button asChild>
                <Link href={`/projects/${project.id}/wbs`}>
                  <ListTree aria-hidden />
                  Open Work Breakdown
                </Link>
              </Button>
              <Button variant="outline" asChild>
                <Link href={`/projects/${project.id}`}>
                  <LayoutDashboard aria-hidden />
                  Back to dashboard
                </Link>
              </Button>
            </>
          }
        />
      }
    />
  );
}
