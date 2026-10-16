import Link from "next/link";
import { Logo } from "@/components/shell/logo";
import { cn } from "@/lib/utils";

export type StatusPanelProps = {
  /** Small label above the title, e.g. "Error 404". */
  eyebrow?: React.ReactNode;
  icon: React.ReactNode;
  title: React.ReactNode;
  description?: React.ReactNode;
  /** One primary action, optionally an outline one next to it. */
  actions?: React.ReactNode;
  /** Small print under the actions (reference ids, help text). */
  footer?: React.ReactNode;
  tone?: "neutral" | "danger";
  /** h1 for standalone pages, h2 inside a page that already has a title. */
  headingLevel?: "h1" | "h2";
  className?: string;
};

/**
 * The body of friendly 404/403/error screens (spec §17.2): what happened, why, and the way back.
 * Works inside the app shells and on its own (`StatusPage`).
 */
export function StatusPanel({
  eyebrow,
  icon,
  title,
  description,
  actions,
  footer,
  tone = "neutral",
  headingLevel = "h1",
  className,
}: StatusPanelProps) {
  const Heading = headingLevel;
  return (
    <div className={cn("mx-auto flex w-full max-w-lg flex-col items-center gap-6 text-center", className)}>
      <span
        aria-hidden
        className={cn(
          "grid size-16 place-items-center rounded-2xl ring-8 [&_svg]:size-8",
          tone === "danger"
            ? "bg-danger-soft text-danger-text ring-danger-soft/40"
            : "bg-primary-soft text-primary-text ring-primary-soft/40",
        )}
      >
        {icon}
      </span>
      <div className="flex flex-col gap-2">
        {eyebrow ? (
          <p className="text-[13px] leading-5 font-semibold tracking-wide text-muted-foreground uppercase tabular-nums">
            {eyebrow}
          </p>
        ) : null}
        <Heading className="text-h1 text-balance text-foreground">{title}</Heading>
        {description ? <p className="text-body-lg text-pretty text-muted-foreground">{description}</p> : null}
      </div>
      {actions ? (
        <div className="flex w-full flex-col-reverse items-stretch justify-center gap-2 sm:w-auto sm:flex-row sm:items-center">
          {actions}
        </div>
      ) : null}
      {footer ? <div className="text-caption text-muted-foreground">{footer}</div> : null}
    </div>
  );
}

/** Faint blueprint grid behind standalone status pages (token colors only). */
const BLUEPRINT_GRID: React.CSSProperties = {
  backgroundImage:
    "linear-gradient(to right, var(--border) 1px, transparent 1px), linear-gradient(to bottom, var(--border) 1px, transparent 1px)",
  backgroundSize: "40px 40px",
  maskImage: "radial-gradient(ellipse 60% 55% at 50% 45%, black, transparent)",
  WebkitMaskImage: "radial-gradient(ellipse 60% 55% at 50% 45%, black, transparent)",
};

/** Full-page frame for status screens outside the app shells: logo, blueprint grid, centered panel. */
export function StatusPage({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative isolate flex min-h-dvh flex-col bg-background">
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-10 opacity-70" style={BLUEPRINT_GRID} />
      <header className="px-4 pt-5 sm:px-8 sm:pt-7">
        <Link href="/" aria-label="CivPMS home" className="inline-flex rounded-md focus-ring">
          <Logo size="md" priority />
        </Link>
      </header>
      <main id="main-content" className="flex flex-1 items-center justify-center px-4 pt-10 pb-20 sm:px-8">
        {children}
      </main>
    </div>
  );
}
