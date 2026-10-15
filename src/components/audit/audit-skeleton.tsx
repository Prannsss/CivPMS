import { LoadingLabel, Skeleton } from "@/components/ui/skeleton";

/** Audit Trail while loading: header, filter bar and two day groups. */
export function AuditSkeleton() {
  return (
    <div aria-busy className="flex flex-col gap-5">
      <LoadingLabel />
      <div className="flex flex-col gap-3 pb-1">
        <Skeleton className="h-8 w-44 rounded-md sm:h-9" />
        <Skeleton className="h-4 w-96 max-w-full" />
      </div>
      <div className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4 shadow-xs sm:p-5">
        <div className="flex gap-3">
          <Skeleton className="h-11 flex-1 rounded-md sm:h-10" />
          <Skeleton className="h-11 w-32 rounded-md sm:h-10" />
        </div>
        <div className="hidden gap-3 lg:grid lg:grid-cols-5">
          {Array.from({ length: 5 }, (_, i) => (
            <Skeleton key={i} className="h-10 rounded-md" />
          ))}
        </div>
      </div>
      {[4, 3].map((rows, group) => (
        <div key={group} className="flex flex-col gap-2">
          <Skeleton className="h-4 w-40" />
          <div className="flex flex-col rounded-lg border border-border bg-surface shadow-xs">
            {Array.from({ length: rows }, (_, i) => (
              <div key={i} className="flex gap-3 border-b border-border px-4 py-3.5 last:border-b-0 sm:px-5">
                <Skeleton className="size-8 rounded-full" />
                <div className="flex flex-1 flex-col gap-2">
                  <Skeleton className="h-3.5 w-3/5" />
                  <Skeleton className="h-3 w-40" />
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
