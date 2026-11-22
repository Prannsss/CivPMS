"use client";

import { useId, useRef, useState, useSyncExternalStore } from "react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export type SettingsNavItem = { id: string; label: string; icon: LucideIcon };

function subscribeHash(onChange: () => void) {
  window.addEventListener("hashchange", onChange);
  return () => window.removeEventListener("hashchange", onChange);
}

/**
 * Settings pages (profile, company): the section nav switches the panel beside it, one section at a
 * time (the same pattern as Project Settings). The section lives in the URL hash, so links such as
 * `/profile#notifications` (emails, the notifications page) open it directly. The nav is a vertical
 * list from `lg` and a scrollable row of pills above the panel on smaller screens. Children are the
 * section cards in nav order, each a `<section id>` matching its nav item; the hidden ones stay
 * mounted, so switching never loses an edit in progress.
 */
export function SettingsLayout({
  nav,
  label,
  children,
}: {
  nav: ReadonlyArray<SettingsNavItem>;
  /** Accessible name of the section nav, e.g. "Profile sections". */
  label: string;
  children: React.ReactNode;
}) {
  const scope = useId();
  const panels = useRef<HTMLDivElement>(null);
  const hash = useSyncExternalStore(subscribeHash, () => window.location.hash.slice(1), () => "");
  const [picked, setPicked] = useState<string | null>(null);
  const known = (id: string | null) => (id && nav.some((item) => item.id === id) ? id : null);
  const active = known(picked) ?? known(hash) ?? nav[0]?.id ?? "";

  function select(event: React.MouseEvent<HTMLAnchorElement>, id: string) {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
    event.preventDefault();
    setPicked(id);
    const url = new URL(window.location.href);
    url.hash = id;
    window.history.replaceState(window.history.state, "", url.toString());
    // Bring the panel's top into view when the page was scrolled past it (phones).
    const top = panels.current?.getBoundingClientRect().top ?? 0;
    if (top < 0) panels.current?.scrollIntoView({ block: "start", behavior: "smooth" });
  }

  return (
    <div className="grid items-start gap-5 lg:grid-cols-[13.5rem_minmax(0,1fr)] lg:gap-10">
      <nav aria-label={label} className="-mx-4 min-w-0 sm:mx-0 lg:sticky lg:top-24">
        <ul className="flex gap-1.5 overflow-x-auto px-4 pb-1 sm:px-0 lg:flex-col lg:gap-1 lg:overflow-visible lg:pb-0">
          {nav.map((item) => {
            const Icon = item.icon;
            const current = active === item.id;
            return (
              <li key={item.id} className="shrink-0">
                <a
                  href={`#${item.id}`}
                  aria-current={current ? "true" : undefined}
                  onClick={(event) => select(event, item.id)}
                  className={cn(
                    "flex h-10 items-center gap-3 rounded-md px-3 text-sm font-medium whitespace-nowrap transition-colors duration-200 ease-in-out focus-ring",
                    "max-lg:rounded-full max-lg:border max-lg:px-3.5",
                    current
                      ? "bg-primary-soft text-primary-text max-lg:border-primary/30"
                      : "text-muted-foreground hover:bg-surface-sunken hover:text-foreground max-lg:border-border",
                  )}
                >
                  <Icon aria-hidden className="size-4 shrink-0" />
                  {item.label}
                </a>
              </li>
            );
          })}
        </ul>
      </nav>
      {/* One rule picks the visible section; it is rendered on the server too, so there is no flash. */}
      <style>{`[data-settings-panels="${scope}"] > :not([id="${active}"]) { display: none; }`}</style>
      <div ref={panels} data-settings-panels={scope} className="flex min-w-0 scroll-mt-24 flex-col gap-6 [&>section]:animate-page-in">
        {children}
      </div>
    </div>
  );
}

/** A settings section card: heading + explanation, optional header actions, then the controls. */
export function SettingsCard({
  id,
  title,
  description,
  actions,
  children,
  flush = false,
  tone = "default",
  className,
}: {
  id: string;
  title: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  children: React.ReactNode;
  /** No body padding (tables and lists that run edge to edge). */
  flush?: boolean;
  tone?: "default" | "danger";
  className?: string;
}) {
  return (
    <section
      id={id}
      aria-labelledby={`${id}-title`}
      className={cn(
        "min-w-0 scroll-mt-24 rounded-lg border bg-surface shadow-xs",
        tone === "danger" ? "border-danger/40" : "border-border",
        className,
      )}
    >
      <header className="flex flex-col gap-3 px-5 pt-5 sm:flex-row sm:items-start sm:justify-between sm:px-6 sm:pt-6">
        <div className="flex min-w-0 flex-col gap-1">
          <h2 id={`${id}-title`} className={cn("text-h3", tone === "danger" ? "text-danger-text" : "text-foreground")}>
            {title}
          </h2>
          {description ? <p className="text-sm leading-[1.375rem] text-pretty text-muted-foreground">{description}</p> : null}
        </div>
        {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
      </header>
      <div className={cn(flush ? "mt-4 pb-1" : "px-5 pt-5 pb-5 sm:px-6 sm:pb-6")}>{children}</div>
    </section>
  );
}

/** One labelled row inside a settings card (label + hint on the left, control on the right). */
export function SettingsRow({
  label,
  hint,
  children,
  className,
  labelId,
}: {
  label: React.ReactNode;
  hint?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  labelId?: string;
}) {
  return (
    <div className={cn("flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-6", className)}>
      <div className="flex min-w-0 flex-col gap-0.5">
        <span id={labelId} className="text-sm leading-6 font-medium text-foreground">
          {label}
        </span>
        {hint ? <span className="text-[13px] leading-5 text-muted-foreground">{hint}</span> : null}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}
