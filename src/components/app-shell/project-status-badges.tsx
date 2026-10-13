import { StatusBadge, type DerivedBadge, type ProjectStatus } from "@/components/ui/status-badge";

/** Status first, then derived badges (Delayed, Budget Exceeded, Near Budget Limit), spec §5.3. */
export function ProjectStatusBadges({
  status,
  derived,
  size = "md",
}: {
  status: ProjectStatus;
  derived: ReadonlyArray<DerivedBadge>;
  size?: "sm" | "md";
}) {
  return (
    <>
      <StatusBadge status={status} size={size} />
      {derived.map((badge) => (
        <StatusBadge key={badge} status={badge} size={size} />
      ))}
    </>
  );
}

/** Derived project badges (spec §5.3) from a `project_overview` row. */
export function derivedBadgesFor(project: { is_delayed: boolean | null; budget_state: string | null }): DerivedBadge[] {
  const badges: DerivedBadge[] = [];
  if (project.is_delayed) badges.push("delayed");
  if (project.budget_state === "exceeded") badges.push("budget_exceeded");
  else if (project.budget_state === "near") badges.push("near_budget_limit");
  return badges;
}
