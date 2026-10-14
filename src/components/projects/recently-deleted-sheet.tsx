"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArchiveRestore, Clock, History, TriangleAlert } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { ProjectAvatar } from "@/components/ui/project-color";
import { Sheet, SheetBody, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { toast } from "@/components/ui/toaster";
import { formatRelativeTime } from "@/lib/domain/format";
import { restoreProject } from "@/server/actions/projects";
import type { TrashedProject } from "@/server/queries/projects";
import { restoreDaysLabel, restoreDaysLeft } from "./trash";

/** Initials skip a leading bracketed tag ("[QA] Bohol Bridge" → "BB"). */
function avatarName(name: string): string {
  return name.replace(/^\s*\[[^\]]*\]\s*/, "") || name;
}

export type RecentlyDeletedSheetProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  items: ReadonlyArray<TrashedProject>;
  /** Server render time (ISO), so relative times match between server and client. */
  now: string;
};

/**
 * Owner PM's "Recently deleted" drawer (spec §17.2, A22): projects deleted in the last 30 days with
 * who deleted them, how long is left, and Restore.
 */
export function RecentlyDeletedSheet({ open, onOpenChange, items, now }: RecentlyDeletedSheetProps) {
  const router = useRouter();
  const [restoringId, setRestoringId] = useState<string | null>(null);
  const nowDate = new Date(now);

  async function restore(item: TrashedProject) {
    setRestoringId(item.id);
    const result = await restoreProject({ projectId: item.id });
    setRestoringId(null);
    if (!result.ok) {
      toast.error("Couldn't restore the project", { description: result.error.message });
      return;
    }
    toast.success("Project restored", {
      description: `${result.data.name} is back on your projects list.`,
      action: { label: "Open project", onClick: () => router.push(`/projects/${result.data.id}`) },
    });
    if (items.length <= 1) onOpenChange(false);
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="sm:w-[min(28rem,calc(100%-2.5rem))]" data-testid="recently-deleted-sheet">
        <SheetHeader>
          <SheetTitle>Recently deleted</SheetTitle>
          <SheetDescription>
            Deleted projects stay here for 30 days. Restoring brings back the WBS, calendar and team.
          </SheetDescription>
        </SheetHeader>
        <SheetBody>
          {items.length === 0 ? (
            <EmptyState
              variant="plain"
              size="sm"
              icon={<History />}
              title="Nothing here"
              description="Projects you delete show up here for 30 days, so you can bring them back."
            />
          ) : (
            <ul className="flex flex-col gap-3" aria-label="Deleted projects">
              {items.map((item) => {
                const daysLeft = restoreDaysLeft(item.restoreUntil, nowDate);
                const urgent = daysLeft <= 3;
                return (
                  <li
                    key={item.id}
                    data-testid="trash-item"
                    className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4 shadow-xs"
                  >
                    <div className="flex min-w-0 items-start gap-3">
                      <ProjectAvatar name={avatarName(item.name)} color={item.color} size="md" />
                      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                        <p className="text-sm leading-5 font-semibold break-words text-foreground">{item.name}</p>
                        <p className="text-xs leading-4 text-muted-foreground">
                          Deleted {formatRelativeTime(item.deletedAt, nowDate)}
                          {item.deletedByName ? ` by ${item.deletedByName}` : ""}
                        </p>
                      </div>
                    </div>
                    {item.nameConflict ? (
                      <p className="flex items-start gap-2 rounded-md bg-warning-soft px-3 py-2 text-xs leading-4 text-warning-text">
                        <TriangleAlert aria-hidden className="mt-px size-3.5 shrink-0" />
                        Another project now uses this name. Rename that project first, then restore this one.
                      </p>
                    ) : null}
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <Badge tone={urgent ? "warning" : "neutral"} icon={<Clock />} className="tabular-nums">
                        {restoreDaysLabel(daysLeft)}
                      </Badge>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => restore(item)}
                        loading={restoringId === item.id}
                        disabled={item.nameConflict || daysLeft <= 0 || (restoringId !== null && restoringId !== item.id)}
                        aria-label={`Restore ${item.name}`}
                      >
                        <ArchiveRestore aria-hidden />
                        Restore
                      </Button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </SheetBody>
      </SheetContent>
    </Sheet>
  );
}
