/**
 * Pure filtering, search and sorting for the projects home toolbar. The state lives in the URL
 * (`?status=&q=&sort=`), so a filtered view can be shared and survives a reload.
 */
import type { BudgetState, ProjectStatus } from "@/lib/domain/project";

export const HOME_FILTERS = ["all", "active", "planning", "on_hold", "completed", "attention", "archived"] as const;
export type HomeFilter = (typeof HOME_FILTERS)[number];

export const HOME_SORTS = ["updated", "name", "end"] as const;
export type HomeSort = (typeof HOME_SORTS)[number];

export const DEFAULT_FILTER: HomeFilter = "all";
export const DEFAULT_SORT: HomeSort = "updated";

export const FILTER_LABELS: Record<HomeFilter, string> = {
  all: "All",
  active: "Active",
  planning: "Planning",
  on_hold: "On hold",
  completed: "Completed",
  attention: "Needs attention",
  archived: "Archived",
};

export const SORT_LABELS: Record<HomeSort, string> = {
  updated: "Recently updated",
  name: "Name (A–Z)",
  end: "End date (soonest)",
};

/** The fields the toolbar needs (a subset of HomeProject, so tests stay small). */
export type FilterableProject = {
  name: string;
  siteName: string | null;
  status: ProjectStatus;
  endDate: string;
  updatedAt: string;
  isArchived: boolean;
  isDelayed: boolean;
  budgetState: BudgetState;
};

export type HomeQuery = { filter: HomeFilter; q: string; sort: HomeSort };

const OPEN_STATUSES: ReadonlySet<ProjectStatus> = new Set(["planning", "active", "on_hold"]);

/** Open (not completed/cancelled), not archived, and Delayed or near/over budget (spec §5.3). */
export function needsAttention(project: FilterableProject): boolean {
  return (
    !project.isArchived &&
    OPEN_STATUSES.has(project.status) &&
    (project.isDelayed || project.budgetState !== "ok")
  );
}

export function matchesFilter(project: FilterableProject, filter: HomeFilter): boolean {
  if (filter === "archived") return project.isArchived;
  if (project.isArchived) return false;
  switch (filter) {
    case "all":
      return true;
    case "attention":
      return needsAttention(project);
    default:
      return project.status === filter;
  }
}

/** Lower-cased, accents removed, whitespace collapsed ("Ñ" → "n", "  Cebu " → "cebu"). */
export function normalizeSearch(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/** Every word of the query must appear in the name or site name. */
export function matchesSearch(project: FilterableProject, q: string): boolean {
  const needle = normalizeSearch(q);
  if (!needle) return true;
  const haystack = normalizeSearch(`${project.name} ${project.siteName ?? ""}`);
  return needle.split(" ").every((word) => haystack.includes(word));
}

const collator = new Intl.Collator("en", { sensitivity: "base", numeric: true });

export function compareProjects(a: FilterableProject, b: FilterableProject, sort: HomeSort): number {
  if (sort === "name") return collator.compare(a.name, b.name);
  if (sort === "end") {
    const byEnd = a.endDate.localeCompare(b.endDate);
    return byEnd !== 0 ? byEnd : collator.compare(a.name, b.name);
  }
  const byUpdated = b.updatedAt.localeCompare(a.updatedAt);
  return byUpdated !== 0 ? byUpdated : collator.compare(a.name, b.name);
}

/** Filter, search and sort (stable for ties). */
export function applyHomeQuery<T extends FilterableProject>(projects: ReadonlyArray<T>, query: HomeQuery): T[] {
  return projects
    .filter((p) => matchesFilter(p, query.filter) && matchesSearch(p, query.q))
    .sort((a, b) => compareProjects(a, b, query.sort));
}

/** How many projects each segment holds (search applied, so the counts match what you'd see). */
export function countByFilter(projects: ReadonlyArray<FilterableProject>, q = ""): Record<HomeFilter, number> {
  const counts = Object.fromEntries(HOME_FILTERS.map((f) => [f, 0])) as Record<HomeFilter, number>;
  for (const project of projects) {
    if (!matchesSearch(project, q)) continue;
    for (const filter of HOME_FILTERS) {
      if (matchesFilter(project, filter)) counts[filter] += 1;
    }
  }
  return counts;
}

function isHomeFilter(value: string | null | undefined): value is HomeFilter {
  return typeof value === "string" && (HOME_FILTERS as readonly string[]).includes(value);
}

function isHomeSort(value: string | null | undefined): value is HomeSort {
  return typeof value === "string" && (HOME_SORTS as readonly string[]).includes(value);
}

/** Reads `?status=&q=&sort=`; unknown values fall back to the defaults. */
export function parseHomeQuery(params: { get(name: string): string | null }): HomeQuery {
  const status = params.get("status");
  const sort = params.get("sort");
  return {
    filter: isHomeFilter(status) ? status : DEFAULT_FILTER,
    q: (params.get("q") ?? "").slice(0, 120),
    sort: isHomeSort(sort) ? sort : DEFAULT_SORT,
  };
}

/**
 * The home URL for a query, keeping unrelated params (e.g. `new=1`). Defaults are left out so the
 * plain home stays "/".
 */
export function homeQueryHref(query: HomeQuery, current: URLSearchParams | string = ""): string {
  const params = new URLSearchParams(current);
  params.delete("status");
  params.delete("q");
  params.delete("sort");
  if (query.filter !== DEFAULT_FILTER) params.set("status", query.filter);
  const q = query.q.trim();
  if (q) params.set("q", q);
  if (query.sort !== DEFAULT_SORT) params.set("sort", query.sort);
  const search = params.toString();
  return search ? `/?${search}` : "/";
}

/** "6 projects · 3 need attention" (archived projects are not counted). */
export function homeSummary(projects: ReadonlyArray<FilterableProject>): string {
  const visible = projects.filter((p) => !p.isArchived).length;
  const attention = projects.filter(needsAttention).length;
  const base = `${visible} ${visible === 1 ? "project" : "projects"}`;
  if (attention === 0) return visible === 0 ? "No open projects" : `${base} · all on track`;
  return `${base} · ${attention} ${attention === 1 ? "needs" : "need"} attention`;
}
