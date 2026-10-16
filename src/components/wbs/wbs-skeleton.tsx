import { LoadingLabel, Skeleton } from "@/components/ui";

/** Shaped like the WBS screen: header, budget panel, toolbar and table rows (no layout jump). */
export function WbsSkeleton() {
  return (
    <div aria-busy className="flex flex-col gap-5">
      <LoadingLabel />
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex flex-col gap-3">
          <Skeleton className="h-8 w-56 rounded-md sm:h-9" />
          <Skeleton className="h-4 w-80 max-w-full" />
        </div>
        <div className="flex flex-wrap gap-2">
          <Skeleton className="h-10 w-40 rounded-full" />
          <Skeleton className="h-10 w-32 rounded-full" />
          <Skeleton className="h-11 w-40 rounded-md sm:h-10" />
        </div>
      </div>
      <div className="grid gap-5 rounded-lg border border-border bg-surface p-5 shadow-xs sm:grid-cols-3 sm:p-6 lg:grid-cols-[2fr_1fr_1fr_1fr]">
        <div className="flex flex-col gap-2 sm:col-span-3 lg:col-span-1">
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-2 w-full rounded-full" />
          <Skeleton className="h-4 w-64 max-w-full" />
        </div>
        {Array.from({ length: 3 }, (_, i) => (
          <div key={i} className="flex items-start gap-3">
            <Skeleton className="size-9 rounded-md" />
            <div className="flex flex-col gap-1.5">
              <Skeleton className="h-3 w-16" />
              <Skeleton className="h-4 w-28" />
            </div>
          </div>
        ))}
      </div>
      <div className="flex gap-2">
        <Skeleton className="h-11 w-full rounded-md sm:h-10 sm:w-72" />
      </div>
      <div className="overflow-hidden rounded-lg border border-border bg-surface shadow-xs">
        <Skeleton className="h-10 w-full rounded-none" />
        {Array.from({ length: 8 }, (_, i) => (
          <div key={i} className="flex h-11 items-center gap-4 border-t border-border px-3">
            <Skeleton className="h-3.5 w-10" />
            <Skeleton className="h-3.5" style={{ width: `${30 - (i % 3) * 6}%`, marginLeft: (i % 3) * 22 }} />
            <Skeleton className="ml-auto hidden h-3.5 w-24 sm:block" />
            <Skeleton className="hidden h-3.5 w-20 md:block" />
            <Skeleton className="hidden h-5 w-20 rounded-full md:block" />
          </div>
        ))}
      </div>
    </div>
  );
}
