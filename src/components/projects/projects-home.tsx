"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { ArrowDownUp, History, Plus, Search, X } from "lucide-react";
import { PendingInvitations, type PendingInvitation } from "@/components/invitations/pending-invitations";
import { Button } from "@/components/ui/button";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "@/components/ui/toaster";
import { pluralize } from "@/lib/domain/format";
import { cn } from "@/lib/utils";
import { deleteProject, restoreProject, setProjectArchived } from "@/server/actions/projects";
import type { HomeProject, TrashedProject } from "@/server/queries/projects";
import { AddProjectTile } from "./add-project-tile";
import { CreateProjectDialog } from "./create-project-dialog";
import { FilteredEmptyState, FirstRunEmptyState, NoAssignedProjectsState } from "./home-empty-states";
import {
  applyHomeQuery,
  countByFilter,
  FILTER_LABELS,
  HOME_FILTERS,
  HOME_SORTS,
  homeQueryHref,
  homeSummary,
  parseHomeQuery,
  SORT_LABELS,
  type HomeFilter,
  type HomeQuery,
  type HomeSort,
} from "./home-filters";
import { ProjectCard } from "./project-card";
import { RecentlyDeletedSheet } from "./recently-deleted-sheet";
import { suggestedProjectColor } from "./trash";

export type ProjectsHomeProps = {
  projects: HomeProject[];
  /** Owner PM's trash; null for everyone else (no "Recently deleted"). */
  trash: TrashedProject[] | null;
  invitations: PendingInvitation[];
  canCreate: boolean;
  isOwner: boolean;
  companyId: string;
  companyName: string;
  email: string;
  /** Server render time (ISO) for relative times. */
  now: string;
};

/** Filters where the "Add project" tile makes sense (a new project starts in Planning). */
const TILE_FILTERS: ReadonlySet<HomeFilter> = new Set(["all", "planning", "active"]);

/**
 * The projects home for company members (mockups 6–7): header with a count summary, URL-synced
 * toolbar (segment, search, sort), the card grid with the "Add project" tile, the create dialog
 * (also opened by `/?new=1` from the command palette) and the Owner PM's "Recently deleted" drawer.
 */
export function ProjectsHome({
  projects,
  trash,
  invitations,
  canCreate,
  isOwner,
  companyId,
  companyName,
  email,
  now,
}: ProjectsHomeProps) {
  const searchParams = useSearchParams();
  const search = searchParams.toString();
  const confirm = useConfirm();
  const [trashOpen, setTrashOpen] = useState(false);

  // The toolbar state lives in the URL (?status=&q=&sort=). It is mirrored in local state so typing
  // never waits for the router, and re-read whenever the URL changes from elsewhere (palette, links).
  const [query, setQuery] = useState<HomeQuery>(() => parseHomeQuery(searchParams));
  const [seenSearch, setSeenSearch] = useState(search);
  const queryRef = useRef(query);
  if (seenSearch !== search) {
    setSeenSearch(search);
    const next = parseHomeQuery(searchParams);
    if (homeQueryHref(next) !== homeQueryHref(query)) setQuery(next);
  }
  useEffect(() => {
    queryRef.current = query;
  }, [query]);

  const createOpen = canCreate && searchParams.get("new") === "1";

  /** replaceState keeps the URL in sync without a server round trip (Next syncs useSearchParams). */
  const updateQuery = useCallback((patch: Partial<HomeQuery>) => {
    const next = { ...queryRef.current, ...patch };
    queryRef.current = next;
    setQuery(next);
    window.history.replaceState(null, "", homeQueryHref(next, window.location.search));
  }, []);

  const setCreateOpen = useCallback((open: boolean) => {
    const params = new URLSearchParams(window.location.search);
    if (open) params.set("new", "1");
    else params.delete("new");
    const next = params.toString();
    window.history.replaceState(null, "", next ? `/?${next}` : "/");
  }, []);

  const visible = useMemo(() => applyHomeQuery(projects, query), [projects, query]);
  const counts = useMemo(() => countByFilter(projects, query.q), [projects, query.q]);
  const summary = homeSummary(projects);
  const hasAnyProject = projects.length > 0;
  const trashCount = trash?.length ?? 0;
  const filtered = query.filter !== "all" || query.q.trim() !== "";

  async function handleArchive(project: HomeProject, archived: boolean) {
    const result = await setProjectArchived({ projectId: project.id, archived });
    if (!result.ok) {
      toast.error(archived ? "Couldn't archive the project" : "Couldn't unarchive the project", {
        description: result.error.message,
      });
      return;
    }
    toast.undo(archived ? "Project archived" : "Project unarchived", async () => {
      const undo = await setProjectArchived({ projectId: project.id, archived: !archived });
      if (!undo.ok) toast.error("Couldn't undo", { description: undo.error.message });
    }, {
      description: archived ? `${project.name} moved to Archived.` : `${project.name} is back on your list.`,
    });
  }

  async function handleDelete(project: HomeProject) {
    const ok = await confirm({
      title: `Delete “${project.name}”?`,
      description:
        "The project, its WBS, calendar and team access disappear for everyone. You can restore it from Recently deleted within 30 days.",
      tone: "danger",
      confirmLabel: "Delete project",
      confirmText: project.name,
    });
    if (!ok) return;
    const result = await deleteProject({ projectId: project.id });
    if (!result.ok) {
      toast.error("Couldn't delete the project", { description: result.error.message });
      return;
    }
    toast.undo("Project deleted", async () => {
      const undo = await restoreProject({ projectId: project.id });
      if (!undo.ok) toast.error("Couldn't restore the project", { description: undo.error.message });
      else toast.success("Project restored", { description: undo.data.name });
    }, { description: `${project.name} is in Recently deleted for 30 days.` });
  }

  const headerActions = (
    <>
      {isOwner && trashCount > 0 ? (
        <Button variant="ghost" onClick={() => setTrashOpen(true)} data-testid="open-trash">
          <History aria-hidden />
          Recently deleted
          <span className="grid h-5 min-w-5 place-items-center rounded-full bg-surface-sunken px-1.5 text-[11px] leading-4 font-semibold tabular-nums text-muted-foreground">
            {trashCount}
          </span>
        </Button>
      ) : null}
      {canCreate && hasAnyProject ? (
        <Button onClick={() => setCreateOpen(true)} data-testid="add-project">
          <Plus aria-hidden />
          Add project
        </Button>
      ) : null}
    </>
  );

  return (
    <>
      <PageHeader
        title="Projects"
        description={
          hasAnyProject
            ? summary
            : canCreate
              ? `${companyName} has no projects yet.`
              : "Projects you're added to show up here."
        }
        actions={headerActions}
      />

      <div className="flex flex-col gap-8">
        <PendingInvitations
          invitations={invitations}
          currentCompanyId={companyId}
          currentCompanyName={companyName}
          description="Accept to open the project."
        />

        {!hasAnyProject ? (
          canCreate ? (
            <FirstRunEmptyState onAddProject={() => setCreateOpen(true)} isOwner={isOwner} />
          ) : (
            <NoAssignedProjectsState email={email} companyName={companyName} />
          )
        ) : (
          <section aria-labelledby="projects-grid-heading" className="flex flex-col gap-5">
            <h2 id="projects-grid-heading" className="sr-only">
              Your projects
            </h2>
            <Toolbar query={query} counts={counts} onChange={updateQuery} />
            <p className="sr-only" role="status" aria-live="polite">
              {filtered ? `Showing ${pluralize(visible.length, "project")}.` : ""}
            </p>

            {visible.length === 0 ? (
              <FilteredEmptyState
                filter={query.filter}
                query={query.q}
                onReset={() => updateQuery({ filter: "all", q: "" })}
              />
            ) : (
              <ul role="list" className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4" data-testid="projects-grid">
                {visible.map((project) => (
                  <li key={project.id} className="flex flex-col [&>article]:flex-1">
                    <ProjectCard project={project} onArchive={handleArchive} onDelete={handleDelete} />
                  </li>
                ))}
                {canCreate && TILE_FILTERS.has(query.filter) && !query.q.trim() ? (
                  <li className="flex flex-col">
                    <AddProjectTile onClick={() => setCreateOpen(true)} />
                  </li>
                ) : null}
              </ul>
            )}
          </section>
        )}
      </div>

      {canCreate ? (
        <CreateProjectDialog
          open={createOpen}
          onOpenChange={setCreateOpen}
          suggestedColor={suggestedProjectColor(projects.length)}
          companyName={companyName}
        />
      ) : null}
      {trash ? <RecentlyDeletedSheet open={trashOpen} onOpenChange={setTrashOpen} items={trash} now={now} /> : null}
    </>
  );
}

function Toolbar({
  query,
  counts,
  onChange,
}: {
  query: HomeQuery;
  counts: Record<HomeFilter, number>;
  onChange: (patch: Partial<HomeQuery>) => void;
}) {
  return (
    <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
      {/* Seven segments don't fit a phone: the row scrolls sideways inside the page gutter. */}
      <div className="-mx-4 overflow-x-auto px-4 [scrollbar-width:none] sm:-mx-6 sm:px-6 lg:mx-0 lg:px-0 [&::-webkit-scrollbar]:hidden">
        <SegmentedControl
          aria-label="Filter projects by status"
          value={query.filter}
          onValueChange={(filter) => onChange({ filter })}
          options={HOME_FILTERS.map((filter) => ({
            value: filter,
            label: (
              <span className="inline-flex items-center gap-1.5">
                {FILTER_LABELS[filter]}
                {counts[filter] > 0 || filter === query.filter ? (
                  <span
                    className={cn(
                      "min-w-4 rounded-full px-1.5 text-center text-[11px] leading-4 font-semibold tabular-nums",
                      filter === "attention" && counts.attention > 0
                        ? "bg-danger-soft text-danger-text"
                        : "bg-surface-sunken text-muted-foreground in-data-[state=on]:bg-surface-muted",
                    )}
                  >
                    {counts[filter]}
                  </span>
                ) : null}
              </span>
            ),
          }))}
        />
      </div>
      <div className="flex gap-2 sm:items-center">
        <Input
          type="search"
          aria-label="Search projects by name or site"
          placeholder="Search name or site"
          value={query.q}
          onChange={(event) => onChange({ q: event.target.value })}
          onKeyDown={(event) => {
            if (event.key === "Escape" && query.q) {
              event.preventDefault();
              onChange({ q: "" });
            }
          }}
          leading={<Search aria-hidden />}
          trailing={
            query.q ? (
              <button
                type="button"
                onClick={() => onChange({ q: "" })}
                aria-label="Clear search"
                className="grid size-9 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-surface-sunken hover:text-foreground focus-ring sm:size-8"
              >
                <X aria-hidden className="size-4" />
              </button>
            ) : null
          }
          wrapperClassName="min-w-0 flex-1 xl:w-56 xl:flex-none"
          className="[&::-webkit-search-cancel-button]:hidden"
        />
        <Select value={query.sort} onValueChange={(sort) => onChange({ sort: sort as HomeSort })}>
          <SelectTrigger aria-label="Sort projects" className="w-auto shrink-0 gap-2 sm:w-[13.5rem]">
            <ArrowDownUp aria-hidden className="size-4 shrink-0 text-muted-foreground" />
            <span className="hidden sm:inline">
              <SelectValue />
            </span>
          </SelectTrigger>
          <SelectContent align="end" className="min-w-[13.5rem]">
            {HOME_SORTS.map((sort) => (
              <SelectItem key={sort} value={sort}>
                {SORT_LABELS[sort]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}
