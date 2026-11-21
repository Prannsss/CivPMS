import { Skeleton } from "@/components/ui/skeleton";

/** Skeleton in the S-curve's shape: header, KPI row, chart card (no layout shift). */
export default function SCurveLoading() {
  return (
    <div className="flex flex-col gap-5" aria-busy="true" aria-label="Loading the S-curve">
      <div className="flex flex-col gap-2">
        <Skeleton className="h-9 w-40" />
        <Skeleton className="h-5 w-full max-w-xl" />
      </div>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} className="h-28 rounded-lg" />
        ))}
      </div>
      <Skeleton className="h-16 rounded-lg" />
      <div className="flex flex-col gap-4 rounded-lg border border-border p-4 sm:p-5">
        <div className="flex items-center justify-between gap-3">
          <Skeleton className="h-6 w-40" />
          <Skeleton className="h-7 w-48" />
        </div>
        <Skeleton className="h-[300px] w-full" />
      </div>
    </div>
  );
}
