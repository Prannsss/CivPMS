import { LoadingLabel, Skeleton } from "@/components/ui/skeleton";

/** Collaborators while loading: header + members card + two side-by-side cards. */
export function CollaboratorsSkeleton() {
  return (
    <div aria-busy className="flex flex-col gap-6">
      <LoadingLabel />
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex flex-col gap-3">
          <Skeleton className="h-8 w-48 rounded-md sm:h-9" />
          <Skeleton className="h-4 w-72 max-w-full" />
        </div>
        <Skeleton className="h-11 w-36 rounded-md sm:h-10" />
      </div>
      <div className="flex flex-col rounded-lg border border-border bg-surface shadow-xs">
        <div className="flex flex-col gap-2 p-5 sm:p-6">
          <Skeleton className="h-4 w-28" />
          <Skeleton className="h-3.5 w-80 max-w-full" />
        </div>
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="flex items-center gap-3 border-t border-border px-5 py-3.5 sm:px-6">
            <Skeleton className="size-10 rounded-full" />
            <div className="flex flex-1 flex-col gap-2">
              <Skeleton className="h-3.5 w-40" />
              <Skeleton className="h-3 w-56 max-w-full" />
            </div>
            <Skeleton className="hidden h-6 w-28 rounded-full md:block" />
            <Skeleton className="h-9 w-20 rounded-md" />
          </div>
        ))}
      </div>
      <div className="grid gap-6 xl:grid-cols-2">
        {[0, 1].map((i) => (
          <div key={i} className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-5 shadow-xs sm:p-6">
            <Skeleton className="h-4 w-36" />
            <Skeleton className="h-3.5 w-64 max-w-full" />
            <Skeleton className="mt-2 h-12 w-full rounded-md" />
            <Skeleton className="h-12 w-full rounded-md" />
          </div>
        ))}
      </div>
    </div>
  );
}
