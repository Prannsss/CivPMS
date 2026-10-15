import { cn } from "@/lib/utils";

/** A settings block: title + explanation on the left (top on phones), the controls in a card. */
export function SettingsSection({
  id,
  title,
  description,
  children,
  tone = "default",
  className,
}: {
  id: string;
  title: string;
  description: React.ReactNode;
  children: React.ReactNode;
  tone?: "default" | "danger";
  className?: string;
}) {
  return (
    <section
      id={id}
      aria-labelledby={`${id}-title`}
      className={cn("grid scroll-mt-24 gap-4 lg:grid-cols-[minmax(0,17rem)_minmax(0,1fr)] lg:gap-10", className)}
    >
      <div className="flex flex-col gap-1.5 lg:pt-1">
        <h2 id={`${id}-title`} className={cn("text-h3", tone === "danger" ? "text-danger-text" : "text-foreground")}>
          {title}
        </h2>
        <p className="text-sm leading-[1.375rem] text-pretty text-muted-foreground">{description}</p>
      </div>
      <div
        className={cn(
          "min-w-0 rounded-lg border bg-surface p-5 shadow-xs sm:p-6",
          tone === "danger" ? "border-danger/40" : "border-border",
        )}
      >
        {children}
      </div>
    </section>
  );
}
