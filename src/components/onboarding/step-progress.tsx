import { cn } from "@/lib/utils";

export type StepProgressProps = {
  /** 1-based. */
  current: number;
  labels: readonly string[];
  className?: string;
};

/** "Step 2 of 3 · Your role" with a segmented bar (onboarding progress indicator). */
export function StepProgress({ current, labels, className }: StepProgressProps) {
  const total = labels.length;
  return (
    <div className={cn("flex flex-col gap-2.5", className)} data-testid="onboarding-progress" data-step={current}>
      <div
        role="progressbar"
        aria-valuemin={1}
        aria-valuemax={total}
        aria-valuenow={current}
        aria-valuetext={`Step ${current} of ${total}: ${labels[current - 1] ?? ""}`}
        aria-label="Onboarding progress"
        className="grid gap-1.5"
        style={{ gridTemplateColumns: `repeat(${total}, minmax(0, 1fr))` }}
      >
        {labels.map((label, index) => (
          <span
            key={label}
            className={cn(
              "h-1.5 rounded-full transition-colors duration-200",
              index < current ? "bg-primary" : "bg-surface-sunken dark:bg-border",
            )}
          />
        ))}
      </div>
      <p className="text-[13px] leading-5 font-medium text-muted-foreground tabular-nums">
        Step {current} of {total}
        <span aria-hidden> · </span>
        <span className="text-foreground">{labels[current - 1]}</span>
      </p>
    </div>
  );
}
