import { cn } from "@/lib/utils";

export type SectionHeaderProps = Omit<React.ComponentProps<"div">, "title"> & {
  title: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  /** Small count or badge next to the title, e.g. "12". */
  count?: React.ReactNode;
  /** Heading level (h2 for page sections, h3 inside cards). */
  as?: "h2" | "h3";
};

export function SectionHeader({
  title,
  description,
  actions,
  count,
  as: Heading = "h2",
  className,
  ...props
}: SectionHeaderProps) {
  return (
    <div
      className={cn("flex flex-col gap-3 pb-4 sm:flex-row sm:items-end sm:justify-between sm:gap-6", className)}
      {...props}
    >
      <div className="flex min-w-0 flex-col gap-1">
        <div className="flex items-center gap-2">
          {/* Plain strings, not cn(): tailwind-merge would drop text-h2 next to a text color. */}
          <Heading className={Heading === "h2" ? "text-h2 text-foreground" : "text-h3 text-foreground"}>{title}</Heading>
          {count !== undefined ? (
            <span className="inline-flex h-6 min-w-6 items-center justify-center rounded-full bg-surface-sunken px-2 text-xs font-semibold text-muted-foreground tabular-nums">
              {count}
            </span>
          ) : null}
        </div>
        {description ? <p className="text-body text-muted-foreground">{description}</p> : null}
      </div>
      {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}
