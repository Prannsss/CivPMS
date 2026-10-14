import Link from "next/link";
import { Logo } from "@/components/shell/logo";
import { ThemeToggle } from "@/components/shell/theme-toggle";
import { APP_NAME } from "@/lib/constants";
import { cn } from "@/lib/utils";
import { AuthShowcase } from "./auth-showcase";

export type AuthFrameProps = {
  children: React.ReactNode;
  /** The right-hand panel (hidden below lg). Defaults to the brand showcase. */
  aside?: React.ReactNode;
  /** `default` (400 px) for auth forms, `wide` (560 px) for onboarding and invitations. */
  width?: "default" | "wide";
  /** Extra content on the right of the header row (e.g. "Signed in as …"). */
  headerAside?: React.ReactNode;
};

/**
 * Split layout of the auth, onboarding and invitation screens (mockups 3–5): the form column on
 * the left (logo, content, footer) and the rounded brand panel on the right from `lg`.
 */
export function AuthFrame({ children, aside, width = "default", headerAside }: AuthFrameProps) {
  return (
    <div className="flex min-h-dvh w-full bg-background">
      <a
        href="#main-content"
        className="sr-only z-50 rounded-md bg-surface px-4 py-2 text-sm font-medium text-foreground shadow-popover focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus-ring"
      >
        Skip to content
      </a>
      <div className="flex min-w-0 flex-1 flex-col px-4 sm:px-8 lg:px-12 xl:px-16">
        <header className="flex h-[72px] shrink-0 items-center justify-between gap-3 sm:h-20">
          <Link href="/" aria-label={`${APP_NAME} home`} className="inline-flex rounded-md focus-ring">
            <Logo size="md" priority />
          </Link>
          <div className="flex min-w-0 items-center gap-2">
            {headerAside}
            <ThemeToggle />
          </div>
        </header>
        <main id="main-content" tabIndex={-1} className="flex flex-1 flex-col justify-start pt-4 pb-8 outline-none sm:justify-center sm:py-12">
          <div className={cn("mx-auto w-full", width === "wide" ? "max-w-[560px]" : "max-w-[400px]")}>{children}</div>
        </main>
        <footer className="flex shrink-0 flex-wrap items-center justify-between gap-x-4 gap-y-1 py-6 text-caption text-muted-foreground">
          <span>© {APP_NAME}</span>
          <span>Built for engineering and construction teams</span>
        </footer>
      </div>
      <aside
        aria-label={`About ${APP_NAME}`}
        className="sticky top-0 hidden h-dvh w-[48%] max-w-[880px] shrink-0 p-4 lg:flex xl:p-5"
      >
        {aside ?? <AuthShowcase />}
      </aside>
    </div>
  );
}

export type AuthHeadingProps = {
  title: React.ReactNode;
  description?: React.ReactNode;
  /** Small element above the title (step counter, icon). */
  eyebrow?: React.ReactNode;
  className?: string;
};

/** The page title block of an auth screen: display title + one-line tagline. */
export function AuthHeading({ title, description, eyebrow, className }: AuthHeadingProps) {
  return (
    <div className={cn("flex flex-col gap-2", className)}>
      {eyebrow}
      <h1 className="text-display text-balance text-foreground">{title}</h1>
      {description ? <p className="text-body-lg text-pretty text-muted-foreground">{description}</p> : null}
    </div>
  );
}

const authIconTones = {
  primary: "bg-primary-soft text-primary-text",
  warning: "bg-warning-soft text-warning-text",
} as const;

/** The icon tile above the title of a message-style auth screen (check email, expired link, …). */
export function AuthIcon({ tone = "primary", children }: { tone?: keyof typeof authIconTones; children: React.ReactNode }) {
  return (
    <span
      aria-hidden
      className={cn(
        "mb-4 grid size-14 place-items-center rounded-2xl ring-1 ring-current/15 [&_svg]:size-7",
        authIconTones[tone],
      )}
    >
      {children}
    </span>
  );
}

/** "or" separator between the email form and Google. */
export function AuthDivider({ label = "or" }: { label?: string }) {
  return (
    <div className="flex items-center gap-3" role="separator" aria-label={label}>
      <span className="h-px flex-1 bg-border" />
      <span className="text-caption font-medium tracking-wide text-muted-foreground uppercase">{label}</span>
      <span className="h-px flex-1 bg-border" />
    </div>
  );
}
