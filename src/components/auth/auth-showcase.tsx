import { ChartSpline, CircleCheck, ClipboardCheck, ListTree } from "lucide-react";
import { Logo } from "@/components/shell/logo";
import { Meter } from "@/components/ui/meter";
import { Progress } from "@/components/ui/progress";
import { ProjectAvatar } from "@/components/ui/project-color";
import { StatusBadge } from "@/components/ui/status-badge";
import { cn } from "@/lib/utils";
import styles from "./auth-showcase.module.css";

/** Faint blueprint grid on the blue panel (white hairlines, masked toward the edges). */
const PANEL_GRID: React.CSSProperties = {
  backgroundImage:
    "linear-gradient(to right, rgb(255 255 255 / 0.07) 1px, transparent 1px), linear-gradient(to bottom, rgb(255 255 255 / 0.07) 1px, transparent 1px)",
  backgroundSize: "44px 44px",
  maskImage: "radial-gradient(ellipse 85% 70% at 70% 40%, black, transparent)",
  WebkitMaskImage: "radial-gradient(ellipse 85% 70% at 70% 40%, black, transparent)",
};

export type AuthShowcasePanelProps = {
  children: React.ReactNode;
  className?: string;
};

/**
 * The rounded brand panel on the right of the auth and onboarding screens (mockups 3–5, D32):
 * brand blue in light mode, a deep blue-to-graphite in dark mode so it doesn't glare on black.
 * White text only (≥ 4.8:1 on every stop of the gradient).
 */
export function AuthShowcasePanel({ children, className }: AuthShowcasePanelProps) {
  return (
    <div
      className={cn(
        "relative isolate flex h-full w-full flex-col overflow-hidden rounded-[28px] p-10 text-white xl:p-12",
        "bg-linear-to-br from-primary via-primary to-project-blue-to shadow-lg",
        "dark:from-project-blue-to dark:via-project-blue-to dark:to-project-graphite-to dark:ring-1 dark:ring-white/10",
        className,
      )}
    >
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-10" style={PANEL_GRID} />
      <div
        aria-hidden
        className="pointer-events-none absolute -top-40 -right-32 -z-10 size-[520px] rounded-full bg-white/10 blur-3xl"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute -bottom-48 -left-40 -z-10 size-[460px] rounded-full bg-project-blue-to/60 blur-3xl dark:bg-primary/25"
      />
      <Logo variant="white" size="md" />
      {children}
    </div>
  );
}

const FEATURES = [
  {
    icon: ListTree,
    title: "WBS & budgets",
    description: "Deliverables to work packages, with budgets that add up.",
  },
  {
    icon: ChartSpline,
    title: "Schedules & S-curves",
    description: "Working calendars and progress your client understands at a glance.",
  },
  {
    icon: ClipboardCheck,
    title: "Site inspections",
    description: "Propose, approve and record inspections straight from the site.",
  },
] as const;

/** Default panel content: value proposition, a live-looking product vignette and three highlights. */
export function AuthShowcase() {
  return (
    <AuthShowcasePanel>
      <div className="mt-10 flex max-w-[34rem] flex-col gap-4 xl:mt-12">
        <p className={cn("text-display text-balance text-white", styles.rise)}>
          Every project on budget, on schedule and on site.
        </p>
        <p className={cn("text-body-lg text-pretty text-white", styles.rise, styles.delay1)}>
          Plan the work, track every peso and inspect the site in one place your whole team understands.
        </p>
      </div>

      <div className={cn("flex flex-1 items-center justify-center py-8", styles.rise, styles.delay2)}>
        <ShowcaseVignette />
      </div>

      <ul className={cn("grid grid-cols-3 gap-5 border-t border-white/20 pt-6 xl:gap-8", styles.rise, styles.delay3)}>
        {FEATURES.map(({ icon: Icon, title, description }) => (
          <li key={title} className="flex flex-col gap-2.5">
            <span aria-hidden className="grid size-10 place-items-center rounded-xl bg-white/15 ring-1 ring-white/20">
              <Icon className="size-5" />
            </span>
            <span className="text-sm leading-5 font-semibold">{title}</span>
            <span className="text-[13px] leading-5 text-pretty text-white">{description}</span>
          </li>
        ))}
      </ul>
    </AuthShowcasePanel>
  );
}

/**
 * Decorative product vignette: an S-curve card behind a project card with real design-system
 * components, plus a floating "inspection approved" chip. Hidden from assistive tech.
 */
function ShowcaseVignette() {
  return (
    <div aria-hidden className="relative h-[340px] w-full max-w-[500px] select-none">
      {/* S-curve card (back) */}
      <div
        className={cn(
          "absolute top-0 right-0 w-[72%] rounded-2xl bg-white/12 p-4 ring-1 ring-white/25 backdrop-blur-sm",
          styles.floatSlow,
        )}
      >
        <div className="flex items-baseline justify-between gap-3">
          <span className="text-[13px] leading-5 font-semibold">Progress S-curve</span>
          <span className="text-xs leading-4 font-medium tabular-nums">62% complete</span>
        </div>
        <svg viewBox="0 0 320 128" className="mt-3 h-auto w-full overflow-visible" fill="none">
          {[0, 32, 64, 96, 128].map((y) => (
            <line key={y} x1="0" x2="320" y1={y} y2={y} stroke="currentColor" strokeOpacity="0.14" strokeWidth="1" />
          ))}
          <path
            d="M0 124 C 70 122, 110 104, 160 70 S 260 8, 320 4"
            pathLength={1}
            className={styles.curvePlanned}
            stroke="currentColor"
            strokeOpacity="0.45"
            strokeWidth="2"
            strokeLinecap="round"
          />
          <path
            d="M0 124 C 60 123, 100 112, 140 88 S 190 52, 212 46"
            pathLength={1}
            className={styles.curve}
            stroke="currentColor"
            strokeWidth="3"
            strokeLinecap="round"
          />
          <circle cx="212" cy="46" r="9" fill="currentColor" className={styles.pulse} />
          <circle cx="212" cy="46" r="5" fill="currentColor" />
        </svg>
        <div className="mt-2 flex items-center gap-4 text-[11px] leading-4 font-medium">
          <span className="inline-flex items-center gap-1.5">
            <span className="h-0.5 w-4 rounded-full bg-white/45" /> Planned
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="h-[3px] w-4 rounded-full bg-white" /> Actual
          </span>
        </div>
      </div>

      {/* Project card (front) */}
      <div
        className={cn(
          "absolute bottom-10 left-0 flex w-[64%] flex-col gap-3.5 rounded-2xl bg-surface p-4 text-foreground shadow-lg ring-1 ring-black/5 dark:ring-white/10",
          styles.float,
        )}
      >
        <div className="flex items-center gap-3">
          <ProjectAvatar name="Cebu Coastal Road" color="blue" size="sm" />
          <div className="flex min-w-0 flex-1 flex-col">
            <span className="truncate text-[13px] leading-5 font-semibold">Cebu Coastal Road</span>
            <span className="truncate text-xs leading-4 text-muted-foreground">Cebu City</span>
          </div>
          <StatusBadge status="active" size="sm" />
        </div>
        <Progress value={62} size="sm" label="Progress" showValue />
        <Meter allocated={134_050_150} budget={190_000_000} size="sm" label="Budget" />
      </div>

      {/* Inspection chip */}
      <div
        className={cn(
          "absolute right-4 bottom-0 flex items-center gap-2.5 rounded-full bg-surface py-2 pr-4 pl-2 text-foreground shadow-lg ring-1 ring-black/5 dark:ring-white/10",
          styles.floatSlow,
        )}
      >
        <span className="grid size-7 place-items-center rounded-full bg-success-soft text-success-text">
          <CircleCheck className="size-4" />
        </span>
        <span className="flex flex-col">
          <span className="text-xs leading-4 font-semibold">Inspection approved</span>
          <span className="text-[11px] leading-4 text-muted-foreground tabular-nums">Pier 3 rebar · 10 Oct 2026</span>
        </span>
      </div>
    </div>
  );
}
