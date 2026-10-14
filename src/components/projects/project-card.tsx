"use client";

import Link from "next/link";
import {
  Archive,
  ArchiveRestore,
  CalendarDays,
  Ellipsis,
  FolderOpen,
  ListTree,
  MapPin,
  Settings,
  Trash2,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { getProjectColor } from "@/components/ui/project-color";
import { STATUS_META, type StatusKey } from "@/components/ui/status-badge";
import { formatDateRange, formatPercent } from "@/lib/domain/format";
import { projectPermissions } from "@/lib/domain/permissions";
import { canArchiveProjectStatus } from "@/lib/domain/project";
import { cn } from "@/lib/utils";
import type { HomeProject } from "@/server/queries/projects";

export type ProjectCardActions = {
  onArchive: (project: HomeProject, archived: boolean) => void;
  onDelete: (project: HomeProject) => void;
};

function derivedFor(project: HomeProject): Array<"delayed" | "budget_exceeded" | "near_budget_limit"> {
  const badges: Array<"delayed" | "budget_exceeded" | "near_budget_limit"> = [];
  if (project.isDelayed) badges.push("delayed");
  if (project.budgetState === "exceeded") badges.push("budget_exceeded");
  else if (project.budgetState === "near") badges.push("near_budget_limit");
  return badges;
}

/** Pill on the gradient: status sits on a dark glass chip, warnings use their solid token fill. */
function CardChip({ status, className }: { status: StatusKey; className?: string }) {
  const meta = STATUS_META[status];
  const Icon = meta.icon;
  return (
    <span
      data-status={status}
      className={cn("inline-flex h-6 items-center gap-1 rounded-full px-2.5 text-[11px] leading-4 font-semibold whitespace-nowrap", className)}
    >
      <Icon aria-hidden className="size-3.5 shrink-0" strokeWidth={2.25} />
      {meta.label}
    </span>
  );
}

/**
 * Home project card (mockup 7, improved per D31): project-color gradient with white text (AA on
 * both stops), status + derived badges, name, site, dates and weighted progress. The whole card is
 * one link (stretched over the card); the ⋯ menu sits above it with its own focus stop.
 */
export function ProjectCard({ project, onArchive, onDelete }: { project: HomeProject } & ProjectCardActions) {
  const color = getProjectColor(project.color);
  const href = `/projects/${project.id}`;
  const permissions = projectPermissions({ companyRole: project.myCompanyRole, projectRole: project.myProjectRole });
  const canArchive = permissions.canArchive && canArchiveProjectStatus(project.status);
  const derived = derivedFor(project);
  const percent = Math.max(0, Math.min(100, project.percentComplete));
  const percentLabel = formatPercent(percent, { decimals: percent > 0 && percent < 10 && percent % 1 !== 0 ? 1 : 0 });

  return (
    <article
      data-testid="project-card"
      data-project-id={project.id}
      aria-labelledby={`project-${project.id}-name`}
      className={cn(
        "group relative isolate flex min-h-56 flex-col overflow-hidden rounded-2xl p-5 text-white shadow-sm",
        "transition-[transform,box-shadow] duration-200 ease-out motion-safe:hover:-translate-y-1 hover:shadow-lg",
        "has-[[data-card-link]:focus-visible]:outline-2 has-[[data-card-link]:focus-visible]:outline-offset-2 has-[[data-card-link]:focus-visible]:outline-ring",
        color.gradient,
        project.isArchived && "saturate-[.55]",
      )}
    >
      {/* Decorative rings + bottom scrim (the scrim only darkens, so text contrast only improves). */}
      <span aria-hidden className="pointer-events-none absolute -top-16 -right-16 -z-10 size-48 rounded-full border-[28px] border-white/10" />
      <span aria-hidden className="pointer-events-none absolute -top-4 -right-4 -z-10 size-20 rounded-full border-[10px] border-white/10" />
      <span aria-hidden className="pointer-events-none absolute inset-x-0 bottom-0 -z-10 h-2/3 bg-linear-to-t from-black/30 to-transparent" />

      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 flex-wrap gap-1.5">
          <CardChip status={project.status} className="bg-black/30" />
          {derived.map((badge) => (
            <CardChip
              key={badge}
              status={badge}
              className={badge === "near_budget_limit" ? "bg-warning text-warning-foreground" : "bg-danger text-danger-foreground"}
            />
          ))}
          {project.isArchived ? (
            <span className="inline-flex h-6 items-center gap-1 rounded-full bg-white/20 px-2.5 text-[11px] leading-4 font-semibold">
              <Archive aria-hidden className="size-3.5" strokeWidth={2.25} />
              Archived
            </span>
          ) : null}
        </div>

        <DropdownMenu modal={false}>
          <DropdownMenuTrigger
            aria-label={`Actions for ${project.name}`}
            className={cn(
              "relative z-10 -mt-1 -mr-1 grid size-11 shrink-0 place-items-center rounded-full bg-black/20 text-white sm:size-9",
              "transition-[opacity,background-color] duration-150 hover:bg-black/35 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white",
              "[@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100 [@media(hover:hover)]:group-has-[[data-card-link]:focus-visible]:opacity-100",
              "focus-visible:opacity-100 data-[state=open]:opacity-100",
            )}
          >
            <Ellipsis aria-hidden className="size-[18px]" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuItem asChild>
              <Link href={href}>
                <FolderOpen aria-hidden />
                Open project
              </Link>
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <Link href={`${href}/wbs`}>
                <ListTree aria-hidden />
                Work breakdown
              </Link>
            </DropdownMenuItem>
            {permissions.canEditProject ? (
              <DropdownMenuItem asChild>
                <Link href={`${href}/settings`}>
                  <Settings aria-hidden />
                  Project settings
                </Link>
              </DropdownMenuItem>
            ) : null}
            {canArchive || permissions.canDelete ? <DropdownMenuSeparator /> : null}
            {canArchive ? (
              <DropdownMenuItem onSelect={() => onArchive(project, !project.isArchived)}>
                {project.isArchived ? <ArchiveRestore aria-hidden /> : <Archive aria-hidden />}
                {project.isArchived ? "Unarchive project" : "Archive project"}
              </DropdownMenuItem>
            ) : null}
            {permissions.canDelete ? (
              <DropdownMenuItem variant="danger" onSelect={() => onDelete(project)}>
                <Trash2 aria-hidden />
                Delete project
              </DropdownMenuItem>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <div className="mt-auto flex flex-col gap-3 pt-8">
        <div className="flex min-w-0 flex-col gap-1">
          <h3 id={`project-${project.id}-name`} className="text-lg leading-6 font-semibold tracking-[-0.01em]">
            <Link
              href={href}
              data-card-link
              className="line-clamp-2 outline-none after:absolute after:inset-0 after:content-['']"
            >
              {project.name}
            </Link>
          </h3>
          <p className="flex min-w-0 items-center gap-1.5 text-[13px] leading-5 text-white/90">
            <MapPin aria-hidden className="size-3.5 shrink-0" />
            <span className={cn("truncate", !project.siteName && "italic")}>{project.siteName ?? "No site yet"}</span>
          </p>
        </div>
        <p className="flex items-center gap-1.5 text-xs leading-4 font-medium tabular-nums">
          <CalendarDays aria-hidden className="size-3.5 shrink-0" />
          <span className="sr-only">Dates: </span>
          {formatDateRange(project.startDate, project.endDate)}
        </p>
        <div className="flex items-center gap-3">
          <div
            role="progressbar"
            aria-label="Progress"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(percent)}
            aria-valuetext={project.leafCount === 0 ? "No activities yet" : `${percentLabel} complete`}
            className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/25"
          >
            <div className="h-full rounded-full bg-white" style={{ width: `${percent}%` }} />
          </div>
          <span className="min-w-9 text-right text-xs font-semibold tabular-nums">{percentLabel}</span>
        </div>
      </div>
    </article>
  );
}
