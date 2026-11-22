import { LoadingLabel, Skeleton } from "@/components/ui/skeleton";

/** Project Settings while loading: header, the section rows and the Details panel. */
export function SettingsSkeleton() {
  return (
    <div aria-busy className="flex flex-col gap-6 lg:gap-8">
      <LoadingLabel />
      <div className="flex flex-col gap-3">
        <Skeleton className="h-8 w-56 rounded-md sm:h-9" />
        <Skeleton className="h-4 w-80 max-w-full" />
      </div>
      <div className="grid items-start gap-5 lg:grid-cols-[17.5rem_minmax(0,1fr)] lg:gap-8">
        <div className="flex flex-col gap-1.5">
          {[0, 1, 2].map((row) => (
            <div key={row} className="flex gap-3 rounded-lg px-4 py-3.5">
              <Skeleton className="size-5 rounded-md" />
              <div className="flex flex-1 flex-col gap-2">
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-3.5 w-full max-w-52" />
              </div>
            </div>
          ))}
        </div>
        <div className="rounded-lg border border-border bg-surface shadow-xs">
          <div className="flex min-h-16 items-center justify-between border-b border-border px-5 sm:px-6">
            <Skeleton className="h-5 w-20" />
            <Skeleton className="size-9 rounded-full" />
          </div>
          <div className="grid gap-x-6 gap-y-5 p-5 sm:grid-cols-2 sm:p-6">
            {Array.from({ length: 8 }, (_, i) => (
              <div key={i} className={i === 0 ? "flex flex-col gap-2 sm:col-span-2" : "flex flex-col gap-2"}>
                <Skeleton className="h-3.5 w-28" />
                <Skeleton className="h-5 w-40 max-w-full" />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
