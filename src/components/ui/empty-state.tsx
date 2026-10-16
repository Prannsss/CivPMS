import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

export type EmptyStateChecklistItem = {
  label: React.ReactNode;
  done?: boolean;
  description?: React.ReactNode;
};

export type EmptyStateProps = Omit<React.ComponentProps<"div">, "title"> & {
  icon?: React.ReactNode;
  title: React.ReactNode;
  description?: React.ReactNode;
  /** The one obvious next step (usually a primary <Button>). */
  action?: React.ReactNode;
  /** A lighter alternative (outline/link button). */
  secondaryAction?: React.ReactNode;
  /** "Not so empty": a short getting-started checklist (spec §4.2). */
  checklist?: ReadonlyArray<EmptyStateChecklistItem>;
  /** `dashed`: bordered panel for in-page sections. `plain`: no frame (inside cards). */
  variant?: "dashed" | "plain";
  size?: "sm" | "md";
  /** Heading level of the title (defaults to h2). */
  headingLevel?: "h2" | "h3" | "h4";
};

/** Every list needs one: explain what goes here and offer the action that fills it. */
export function EmptyState({
  icon,
  title,
  description,
  action,
  secondaryAction,
  checklist,
  variant = "dashed",
  size = "md",
  headingLevel = "h2",
  className,
  ...props
}: EmptyStateProps) {
  const Heading = headingLevel;
  return (
    <div
      data-slot="empty-state"
      className={cn(
        "flex flex-col items-center text-center",
        variant === "dashed" && "rounded-lg border border-dashed border-border-strong bg-surface-muted/60",
        size === "md" ? "gap-5 px-6 py-12 sm:py-14" : "gap-4 px-5 py-8",
        className,
      )}
      {...props}
    >
      {icon ? (
        <span
          aria-hidden
          className={cn(
            "relative grid place-items-center rounded-2xl bg-primary-soft text-primary-text ring-8 ring-primary-soft/40",
            size === "md" ? "size-14 [&_svg]:size-7" : "size-11 [&_svg]:size-5",
          )}
        >
          {icon}
        </span>
      ) : null}
      <div className="flex max-w-md flex-col gap-1.5">
        <Heading className={cn("font-semibold tracking-[-0.01em] text-foreground", size === "md" ? "text-lg leading-[1.625rem]" : "text-base leading-6")}>
          {title}
        </Heading>
        {description ? <p className="text-sm leading-[1.375rem] text-pretty text-muted-foreground">{description}</p> : null}
      </div>
      {checklist && checklist.length > 0 ? (
        <ol className="flex w-full max-w-sm flex-col gap-1 rounded-md border border-border bg-surface p-2 text-left shadow-xs">
          {checklist.map((item, index) => (
            <li key={index} className="flex items-start gap-3 rounded-sm px-2 py-2">
              <span
                aria-hidden
                className={cn(
                  "mt-px grid size-5 shrink-0 place-items-center rounded-full border-[1.5px] text-[11px] font-semibold",
                  item.done
                    ? "border-success bg-success text-success-foreground"
                    : "border-border-strong text-muted-foreground",
                )}
              >
                {item.done ? <Check className="size-3" strokeWidth={3.5} /> : index + 1}
              </span>
              <span className="flex min-w-0 flex-col">
                <span className={cn("text-sm leading-5 font-medium", item.done ? "text-muted-foreground line-through" : "text-foreground")}>
                  {item.label}
                  {item.done ? <span className="sr-only"> (done)</span> : null}
                </span>
                {item.description ? <span className="text-xs leading-4 text-muted-foreground">{item.description}</span> : null}
              </span>
            </li>
          ))}
        </ol>
      ) : null}
      {action || secondaryAction ? (
        <div className="flex w-full flex-col items-stretch justify-center gap-2 sm:w-auto sm:flex-row sm:items-center">
          {action}
          {secondaryAction}
        </div>
      ) : null}
    </div>
  );
}
