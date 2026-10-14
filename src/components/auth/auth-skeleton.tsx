import { LoadingLabel, Skeleton } from "@/components/ui/skeleton";

/** Skeleton of an auth form (heading, two fields, button, divider, Google) — same rhythm, no shift. */
export function AuthFormSkeleton() {
  return (
    <div aria-busy className="flex flex-col gap-8">
      <LoadingLabel />
      <div className="flex flex-col gap-3">
        <Skeleton className="h-10 w-40 rounded-md" />
        <Skeleton className="h-5 w-full max-w-[22rem]" />
      </div>
      <div className="flex flex-col gap-5">
        {[0, 1].map((i) => (
          <div key={i} className="flex flex-col gap-2">
            <Skeleton className="h-4 w-20" />
            <Skeleton className="h-11 w-full rounded-md sm:h-10" />
          </div>
        ))}
        <Skeleton className="mt-1 h-12 w-full rounded-md" />
      </div>
      <Skeleton className="h-px w-full" />
      <Skeleton className="h-12 w-full rounded-md" />
    </div>
  );
}

/** Skeleton for onboarding and the invitation landing (heading, progress, a card). */
export function AuthPanelSkeleton({ steps = true }: { steps?: boolean }) {
  return (
    <div aria-busy className="flex flex-col gap-8">
      <LoadingLabel />
      {steps ? (
        <div className="grid grid-cols-3 gap-2">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-1.5 rounded-full" />
          ))}
        </div>
      ) : null}
      <div className="flex flex-col gap-3">
        <Skeleton className="h-10 w-3/4 rounded-md" />
        <Skeleton className="h-5 w-full" />
      </div>
      <Skeleton className="h-40 w-full rounded-lg" />
      <Skeleton className="h-12 w-full rounded-md" />
    </div>
  );
}
