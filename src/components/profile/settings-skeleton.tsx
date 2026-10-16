import { LoadingLabel, Skeleton } from "@/components/ui/skeleton";

/** Profile / company settings while loading: header, section nav and section cards. */
export function SettingsPageSkeleton({ sections = [4, 3, 5] }: { sections?: number[] }) {
  return (
    <div aria-busy className="flex flex-col">
      <LoadingLabel />
      <div className="flex flex-col gap-3 pb-6 sm:pb-8">
        <Skeleton className="h-8 w-48 rounded-md sm:h-9" />
        <Skeleton className="h-4 w-96 max-w-full" />
      </div>
      <div className="grid gap-6 lg:grid-cols-[13.5rem_minmax(0,1fr)] lg:gap-10">
        <div className="hidden flex-col gap-2 lg:flex">
          {Array.from({ length: 5 }, (_, i) => (
            <Skeleton key={i} className="h-10 w-full rounded-md" />
          ))}
        </div>
        <div className="flex flex-col gap-6">
          {sections.map((rows, index) => (
            <div key={index} className="flex flex-col gap-5 rounded-lg border border-border bg-surface p-5 shadow-xs sm:p-6">
              <div className="flex flex-col gap-2">
                <Skeleton className="h-5 w-32" />
                <Skeleton className="h-3.5 w-72 max-w-full" />
              </div>
              {Array.from({ length: rows }, (_, i) => (
                <div key={i} className="flex items-center justify-between gap-4">
                  <div className="flex flex-1 flex-col gap-2">
                    <Skeleton className="h-3.5 w-40" />
                    <Skeleton className="h-3 w-64 max-w-full" />
                  </div>
                  <Skeleton className="h-9 w-28 rounded-full" />
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
