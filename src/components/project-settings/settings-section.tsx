import { cn } from "@/lib/utils";

/**
 * One Project Settings panel (the content beside the section rows): a titled card with optional
 * header actions (e.g. the Details edit button). It is a labelled region, so tests and screen
 * readers find it by its title.
 */
export function SettingsPanel({
  id,
  title,
  actions,
  children,
  tone = "default",
  className,
}: {
  id: string;
  title: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
  tone?: "default" | "danger";
  className?: string;
}) {
  return (
    <section
      id={`${id}-panel`}
      aria-labelledby={`${id}-title`}
      className={cn(
        "min-w-0 rounded-lg border bg-surface shadow-xs",
        tone === "danger" ? "border-danger/40" : "border-border",
        className,
      )}
    >
      <header className="flex min-h-16 items-center justify-between gap-3 border-b border-border px-5 py-3 sm:px-6">
        <h2 id={`${id}-title`} className={cn("text-h3", tone === "danger" ? "text-danger-text" : "text-foreground")}>
          {title}
        </h2>
        {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
      </header>
      <div className="p-5 sm:p-6">{children}</div>
    </section>
  );
}
