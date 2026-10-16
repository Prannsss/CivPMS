import { LoadingLabel, Skeleton, SkeletonCard } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

/**
 * Route-level skeletons shaped like the real screens (no spinners, no layout jump). Content
 * skeletons render inside a shell; the project frame skeleton stands in for the whole project
 * shell while a project's layout loads (entering a project).
 *
 * There is deliberately no loading.tsx directly under (app): Next prefetches a route down to its
 * first loading boundary, so one there would flash the wrong frame when entering a project.
 */

function HeaderSkeleton({ withAction = true }: { withAction?: boolean }) {
  return (
    <div className="flex flex-col gap-4 pb-6 sm:flex-row sm:items-start sm:justify-between sm:pb-8">
      <div className="flex flex-col gap-3">
        <Skeleton className="h-8 w-48 rounded-md sm:h-9 sm:w-56" />
        <Skeleton className="h-4 w-64 max-w-full sm:w-80" />
      </div>
      {withAction ? <Skeleton className="h-11 w-36 rounded-md sm:h-10" /> : null}
    </div>
  );
}

/** "/" and other top-bar pages: header + project-card grid. */
export function HomeContentSkeleton() {
  return (
    <div aria-busy className="flex flex-col">
      <LoadingLabel />
      <HeaderSkeleton />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <div
            key={i}
            className="flex min-h-56 flex-col justify-between rounded-2xl border border-border bg-surface-muted p-5"
          >
            <div className="flex gap-1.5">
              <Skeleton className="h-6 w-20 rounded-full" />
              <Skeleton className="h-6 w-16 rounded-full" />
            </div>
            <div className="flex flex-col gap-3">
              <Skeleton className="h-5 w-4/5" />
              <Skeleton className="h-3.5 w-1/2" />
              <Skeleton className="h-1.5 w-full rounded-full" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Project tabs: header + KPI row + two cards (dashboard-shaped, close enough for every tab). */
export function ProjectContentSkeleton() {
  return (
    <div aria-busy className="flex flex-col">
      <LoadingLabel />
      <HeaderSkeleton />
      <div className="grid gap-4 sm:grid-cols-2 2xl:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="flex flex-col gap-4 rounded-lg border border-border bg-surface p-5 shadow-xs sm:p-6">
            <div className="flex items-center justify-between">
              <Skeleton className="h-3.5 w-28" />
              <Skeleton className="size-9 rounded-md" />
            </div>
            <Skeleton className="h-7 w-24" />
            <Skeleton className="h-3 w-32" />
          </div>
        ))}
      </div>
      <div className="mt-4 grid gap-4 xl:grid-cols-2">
        <SkeletonCard />
        <SkeletonCard />
      </div>
    </div>
  );
}

function TopBarSkeleton({ className }: { className?: string }) {
  return (
    <div
      aria-hidden
      className={cn(
        "flex h-16 items-center gap-3 px-4 sm:px-6 lg:grid lg:h-20 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)_minmax(max-content,1fr)] lg:gap-6 lg:px-8",
        className,
      )}
    >
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <Skeleton className="hidden size-12 rounded-xl sm:block" />
        <div className="flex flex-col gap-2">
          <Skeleton className="h-3 w-24" />
          <Skeleton className="h-4 w-40" />
        </div>
      </div>
      <Skeleton className="hidden h-12 w-full max-w-xl justify-self-center rounded-full lg:block" />
      <div className="flex items-center justify-end gap-2.5">
        <Skeleton className="hidden size-11 rounded-full sm:block" />
        <Skeleton className="size-11 rounded-full" />
        <Skeleton className="size-11 rounded-full sm:size-12" />
      </div>
    </div>
  );
}

/** Whole project frame (sidebar + top bar + content), while a project's layout loads. */
export function ProjectFrameSkeleton() {
  return (
    <div className="flex min-h-dvh bg-background">
      <div aria-hidden className="sticky top-0 hidden h-dvh w-[18.5rem] shrink-0 p-3 pr-0 lg:block">
        <div className="flex h-full flex-col rounded-2xl bg-sidebar-bg p-3 shadow-md dark:border dark:border-sidebar-border">
          <div className="h-9 w-32 rounded-full bg-sidebar-hover" />
          <div className="flex items-center gap-3 px-2 pt-4 pb-5">
            <div className="size-12 shrink-0 rounded-full bg-sidebar-hover" />
            <div className="flex flex-1 flex-col gap-2">
              <div className="h-4 w-4/5 rounded-sm bg-sidebar-hover" />
              <div className="h-5 w-20 rounded-full bg-sidebar-hover" />
            </div>
          </div>
          <div className="mx-1 h-px bg-sidebar-border" />
          <div className="flex flex-col gap-2 pt-3">
            {Array.from({ length: 8 }, (_, i) => (
              <div
                key={i}
                className={cn("h-11 rounded-md", i === 0 ? "bg-sidebar-active-bg/80" : "bg-sidebar-hover/60")}
              />
            ))}
          </div>
          <div className="mt-auto h-11 rounded-md bg-danger/80" />
        </div>
      </div>
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBarSkeleton />
        <div className="w-full flex-1 px-4 pt-2 pb-12 sm:px-6 lg:px-8 lg:pt-4">
          <ProjectContentSkeleton />
        </div>
      </div>
    </div>
  );
}
