import { Sparkles } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/ui/page-header";
import { cn } from "@/lib/utils";

export type ComingNextFeature = {
  icon: React.ReactNode;
  title: string;
  description: string;
};

export type ComingNextProps = {
  title: string;
  description: string;
  /** e.g. "Phase 2 · Scheduling". */
  phase: string;
  /** Big statement next to the preview. */
  headline: string;
  lead: string;
  /** Decorative preview of the finished view (aria-hidden inside). */
  preview: React.ReactNode;
  /** Plain-language caption read by screen readers instead of the preview. */
  previewLabel: string;
  features: ReadonlyArray<ComingNextFeature>;
  /** "Get ready" panel: readiness facts + the next step people can take today. */
  readiness: React.ReactNode;
};

/**
 * A view that is planned for a later phase (Gantt, S-curve). Not a dead end: it shows what the
 * view will do, how ready this project is for it, and what to do meanwhile (CLAUDE.md: Gantt
 * and S-curve show a "coming next" state in Phases 0–1).
 */
export function ComingNext({
  title,
  description,
  phase,
  headline,
  lead,
  preview,
  previewLabel,
  features,
  readiness,
}: ComingNextProps) {
  return (
    <div className="flex flex-col gap-6" data-testid="coming-next">
      <PageHeader
        className="pb-0 sm:pb-0"
        title={title}
        description={description}
        meta={
          <Badge tone="primary" icon={<Sparkles />}>
            Coming next
          </Badge>
        }
      />

      <section
        aria-labelledby="coming-next-headline"
        className="grid overflow-hidden rounded-xl border border-border bg-surface shadow-xs lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)]"
      >
        <div className="flex flex-col justify-center gap-3 p-6 sm:p-8 lg:p-10">
          <p className="text-xs leading-4 font-semibold tracking-wide text-primary-text uppercase">{phase}</p>
          <h2 id="coming-next-headline" className="text-h1 text-balance text-foreground">
            {headline}
          </h2>
          <p className="text-body-lg text-pretty text-muted-foreground">{lead}</p>
        </div>
        <figure className="relative border-t border-border bg-surface-muted p-4 sm:p-6 lg:border-t-0 lg:border-l">
          <div aria-hidden className="h-full min-h-72">
            {preview}
          </div>
          <figcaption className="sr-only">{previewLabel}</figcaption>
        </figure>
      </section>

      <section aria-label={`What the ${title} will do`}>
        <ul
          className={cn(
            "grid gap-x-6 gap-y-5 rounded-xl border border-border bg-surface-muted/60 p-5 sm:grid-cols-2 sm:p-6",
            features.length % 3 === 0 ? "xl:grid-cols-3" : features.length === 4 ? "2xl:grid-cols-4" : null,
          )}
        >
          {features.map((feature) => (
            <li key={feature.title} className="flex gap-3">
              <span
                aria-hidden
                className="grid size-9 shrink-0 place-items-center rounded-lg bg-primary-soft text-primary-text [&_svg]:size-[18px]"
              >
                {feature.icon}
              </span>
              <div className="flex min-w-0 flex-col gap-0.5">
                <p className="text-sm leading-5 font-semibold text-foreground">{feature.title}</p>
                <p className="text-[13px] leading-5 text-pretty text-muted-foreground">{feature.description}</p>
              </div>
            </li>
          ))}
        </ul>
      </section>

      {readiness}
    </div>
  );
}

export type ReadinessItem = {
  icon: React.ReactNode;
  title: React.ReactNode;
  description: React.ReactNode;
  /** `done` gets a green tile, `todo` a neutral one. */
  state: "done" | "todo";
  /** Optional extra (a progress bar). */
  extra?: React.ReactNode;
};

/** "Get ready" card: what this project already has, and the next step to take today. */
export function ReadinessPanel({
  items,
  actions,
}: {
  items: ReadonlyArray<ReadinessItem>;
  actions: React.ReactNode;
}) {
  return (
    <section aria-labelledby="readiness-heading" className="rounded-xl border border-border bg-surface p-5 shadow-xs sm:p-6">
      <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between lg:gap-8">
        <div className="flex min-w-0 flex-1 flex-col gap-4">
          <h2 id="readiness-heading" className="text-h3 text-foreground">
            Get this project ready
          </h2>
          <ul className="grid gap-4 md:grid-cols-2">
            {items.map((item, index) => (
              <li key={index} className="flex gap-3">
                <span
                  aria-hidden
                  className={cn(
                    "grid size-9 shrink-0 place-items-center rounded-full [&_svg]:size-[18px]",
                    item.state === "done" ? "bg-success-soft text-success-text" : "bg-surface-sunken text-muted-foreground",
                  )}
                >
                  {item.icon}
                </span>
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                  <p className="text-sm leading-5 font-semibold text-foreground">
                    {item.title}
                    <span className="sr-only">{item.state === "done" ? " (done)" : " (to do)"}</span>
                  </p>
                  <p className="text-[13px] leading-5 text-pretty text-muted-foreground">{item.description}</p>
                  {item.extra}
                </div>
              </li>
            ))}
          </ul>
        </div>
        <div className="flex shrink-0 flex-col gap-2 sm:flex-row lg:flex-col xl:flex-row">{actions}</div>
      </div>
    </section>
  );
}
