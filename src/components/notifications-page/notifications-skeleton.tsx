import { LoadingLabel, Skeleton } from "@/components/ui/skeleton";

/** Notifications page while loading: header, filters and a list of rows. */
export function NotificationsSkeleton() {
  return (
    <div aria-busy className="flex flex-col">
      <LoadingLabel />
      <div className="flex flex-col gap-4 pb-6 sm:flex-row sm:items-start sm:justify-between sm:pb-8">
        <div className="flex flex-col gap-3">
          <Skeleton className="h-8 w-52 rounded-md sm:h-9" />
          <Skeleton className="h-4 w-72 max-w-full" />
        </div>
        <Skeleton className="h-10 w-44 rounded-md" />
      </div>
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:justify-between">
        <Skeleton className="h-10 w-44 rounded-full" />
        <Skeleton className="h-10 w-full rounded-full sm:w-72" />
      </div>
      <div className="overflow-hidden rounded-lg border border-border bg-surface shadow-xs">
        <div className="bg-surface-muted px-5 py-2.5 sm:px-6">
          <Skeleton className="h-3 w-16" />
        </div>
        <ul className="flex flex-col divide-y divide-border border-t border-border">
          {Array.from({ length: 6 }, (_, i) => (
            <li key={i} className="flex gap-3.5 px-5 py-4 sm:px-6">
              <Skeleton className="size-10 shrink-0 rounded-full" />
              <div className="flex flex-1 flex-col gap-2">
                <Skeleton className="h-4 w-2/3" />
                <Skeleton className="h-3.5 w-11/12" />
                <Skeleton className="h-3 w-40" />
              </div>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
