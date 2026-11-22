import { Skeleton } from "@/components/ui/skeleton";

/** Fixed-height skeleton in the Gantt's shape: header, toolbar, grid + timeline (no layout shift). */
export default function GanttLoading() {
  return (
    <div className="flex flex-col gap-4" aria-busy="true" aria-label="Loading the Gantt chart">
      <div className="flex flex-col gap-2">
        <Skeleton className="h-9 w-48" />
        <Skeleton className="h-5 w-full max-w-xl" />
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Skeleton className="h-7 w-72" />
        <Skeleton className="h-9 w-64" />
      </div>
      <div className="flex min-h-80 overflow-hidden rounded-lg border border-border">
        <div className="flex w-40 shrink-0 flex-col gap-3 border-r border-border p-3 sm:w-64 lg:w-80">
          <Skeleton className="h-8 w-24" />
          {Array.from({ length: 9 }, (_, i) => (
            <Skeleton key={i} className="h-4" style={{ width: `${85 - (i % 3) * 15}%` }} />
          ))}
        </div>
        <div className="flex flex-1 flex-col gap-3 p-3">
          <Skeleton className="h-8 w-full" />
          {Array.from({ length: 9 }, (_, i) => (
            <Skeleton key={i} className="h-4" style={{ marginLeft: `${(i * 7) % 45}%`, width: `${20 + ((i * 11) % 30)}%` }} />
          ))}
        </div>
      </div>
    </div>
  );
}
