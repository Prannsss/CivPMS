import { LoadingLabel, Skeleton } from "@/components/ui/skeleton";

/** Loading state for "/": header, toolbar and card grid in their final positions (no layout jump). */
export function ProjectsHomeSkeleton() {
  return (
    <div aria-busy className="flex flex-col">
      <LoadingLabel />
      <div className="flex flex-col gap-4 pb-6 sm:flex-row sm:items-start sm:justify-between sm:gap-6 sm:pb-8">
        <div className="flex flex-col gap-2.5">
          <Skeleton className="h-8 w-40 rounded-md sm:h-9" />
          <Skeleton className="h-4 w-56 max-w-full" />
        </div>
        <Skeleton className="h-11 w-36 rounded-md sm:h-10" />
      </div>
      <div className="flex flex-col gap-3 pb-5 xl:flex-row xl:items-center xl:justify-between">
        <Skeleton className="h-11 w-full max-w-[42rem] rounded-full sm:h-10" />
        <div className="flex gap-2">
          <Skeleton className="h-11 flex-1 rounded-md sm:h-10 xl:w-56 xl:flex-none" />
          <Skeleton className="h-11 w-16 rounded-md sm:h-10 sm:w-48" />
        </div>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <div
            key={i}
            className="flex min-h-56 flex-col justify-between rounded-2xl border border-border bg-surface-muted p-5"
          >
            <div className="flex gap-1.5">
              <Skeleton className="h-6 w-20 rounded-full" />
              {i === 1 ? <Skeleton className="h-6 w-16 rounded-full" /> : null}
            </div>
            <div className="flex flex-col gap-3">
              <Skeleton className="h-5 w-4/5" />
              <Skeleton className="h-3.5 w-1/2" />
              <Skeleton className="h-3 w-2/5" />
              <Skeleton className="h-1.5 w-full rounded-full" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
