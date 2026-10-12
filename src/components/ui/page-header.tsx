import { cn } from "@/lib/utils";

export type PageHeaderProps = Omit<React.ComponentProps<"header">, "title"> & {
  title: React.ReactNode;
  description?: React.ReactNode;
  /** Breadcrumbs or a back link, shown above the title. */
  breadcrumbs?: React.ReactNode;
  /** Badges next to the title (status, derived badges). */
  meta?: React.ReactNode;
  /** Page actions. Keep one primary action; the rest outline/ghost. */
  actions?: React.ReactNode;
  /** Leading visual (project avatar, icon tile). */
  leading?: React.ReactNode;
};

/** Top of every page: title (h1), description, breadcrumbs, badges and actions. */
export function PageHeader({
  title,
  description,
  breadcrumbs,
  meta,
  actions,
  leading,
  className,
  ...props
}: PageHeaderProps) {
  return (
    <header data-slot="page-header" className={cn("flex flex-col gap-3 pb-6 sm:pb-8", className)} {...props}>
      {breadcrumbs ? <div className="text-[13px] leading-5 text-muted-foreground">{breadcrumbs}</div> : null}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between sm:gap-6">
        <div className="flex min-w-0 items-start gap-4">
          {leading ? <div className="shrink-0">{leading}</div> : null}
          <div className="flex min-w-0 flex-col gap-1.5">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
              <h1 className="text-h1 min-w-0 break-words text-foreground">{title}</h1>
              {meta ? <div className="flex flex-wrap items-center gap-1.5">{meta}</div> : null}
            </div>
            {description ? (
              <p className="max-w-2xl text-body text-pretty text-muted-foreground">{description}</p>
            ) : null}
          </div>
        </div>
        {actions ? (
          <div className="flex shrink-0 flex-wrap items-center gap-2 sm:justify-end sm:pt-0.5">{actions}</div>
        ) : null}
      </div>
    </header>
  );
}
