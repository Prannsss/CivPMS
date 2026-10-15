import { LoadingLabel, Skeleton } from "@/components/ui/skeleton";

/** Project Settings while loading: header + settings sections (label column + card). */
export function SettingsSkeleton() {
  return (
    <div aria-busy className="flex flex-col gap-8 lg:gap-10">
      <LoadingLabel />
      <div className="flex flex-col gap-3">
        <Skeleton className="h-8 w-56 rounded-md sm:h-9" />
        <Skeleton className="h-4 w-80 max-w-full" />
      </div>
      {[7, 3].map((rows, index) => (
        <div key={index} className="grid gap-4 lg:grid-cols-[minmax(0,17rem)_minmax(0,1fr)] lg:gap-10">
          <div className="flex flex-col gap-2.5">
            <Skeleton className="h-5 w-24" />
            <Skeleton className="h-3.5 w-full max-w-60" />
            <Skeleton className="h-3.5 w-40" />
          </div>
          <div className="flex flex-col gap-5 rounded-lg border border-border bg-surface p-5 shadow-xs sm:p-6">
            {Array.from({ length: rows }, (_, i) => (
              <div key={i} className="flex flex-col gap-2">
                <Skeleton className="h-3.5 w-32" />
                <Skeleton className="h-11 w-full rounded-md sm:h-10" />
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
