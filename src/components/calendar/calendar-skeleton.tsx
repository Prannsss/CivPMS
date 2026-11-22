import { LoadingLabel, Skeleton } from "@/components/ui";

/** Shaped like the calendar screen: header with the gear, summary chip, month grid and side list. */
export function CalendarSkeleton() {
  return (
    <div aria-busy className="flex flex-col gap-5">
      <LoadingLabel />
      <div className="flex items-start justify-between gap-3">
        <div className="flex flex-col gap-3">
          <Skeleton className="h-8 w-40 rounded-md sm:h-9" />
          <Skeleton className="h-4 w-96 max-w-full" />
        </div>
        <Skeleton className="size-11 shrink-0 rounded-full sm:size-10" />
      </div>
      <Skeleton className="h-9 w-72 max-w-full rounded-full" />
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-5 shadow-xs">
          <Skeleton className="h-7 w-48" />
          <div className="grid grid-cols-7 gap-1.5">
            {Array.from({ length: 35 }, (_, i) => (
              <Skeleton key={i} className="h-14 rounded-md sm:h-20" />
            ))}
          </div>
        </div>
        <div className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-5 shadow-xs">
          <Skeleton className="h-9 w-full rounded-full" />
          {Array.from({ length: 6 }, (_, i) => (
            <Skeleton key={i} className="h-12 w-full rounded-md" />
          ))}
        </div>
      </div>
    </div>
  );
}
