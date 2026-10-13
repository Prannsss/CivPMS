import { cn } from "@/lib/utils";

/** Placeholder block for loading states. Size it like the content it replaces (no layout shift). */
export function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="skeleton"
      aria-hidden
      className={cn("animate-shimmer rounded-sm bg-surface-sunken dark:bg-border", className)}
      {...props}
    />
  );
}

/** Lines of text; the last one is shorter, like a real paragraph. */
export function SkeletonText({ lines = 3, className }: { lines?: number; className?: string }) {
  return (
    <div className={cn("flex flex-col gap-2.5", className)} aria-hidden>
      {Array.from({ length: lines }, (_, i) => (
        <Skeleton key={i} className={cn("h-3.5", i === lines - 1 && lines > 1 ? "w-3/5" : "w-full")} />
      ))}
    </div>
  );
}

/** Generic card placeholder (title, two lines, footer row). */
export function SkeletonCard({ className, media = false }: { className?: string; media?: boolean }) {
  return (
    <div
      aria-hidden
      className={cn("flex flex-col gap-4 rounded-lg border border-border bg-surface p-5 shadow-xs sm:p-6", className)}
    >
      {media ? <Skeleton className="h-28 w-full rounded-md" /> : null}
      <div className="flex items-center gap-3">
        <Skeleton className="size-10 rounded-full" />
        <div className="flex flex-1 flex-col gap-2">
          <Skeleton className="h-4 w-1/2" />
          <Skeleton className="h-3 w-1/3" />
        </div>
      </div>
      <SkeletonText lines={2} />
      <div className="flex gap-2">
        <Skeleton className="h-6 w-20 rounded-full" />
        <Skeleton className="h-6 w-24 rounded-full" />
      </div>
    </div>
  );
}

/** Screen-reader announcement to pair with a skeleton region: <div aria-busy>…<LoadingLabel /></div> */
export function LoadingLabel({ children = "Loading…" }: { children?: React.ReactNode }) {
  return (
    <span role="status" className="sr-only">
      {children}
    </span>
  );
}
