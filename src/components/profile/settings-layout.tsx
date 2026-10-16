"use client";

import { useEffect, useState } from "react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export type SettingsNavItem = { id: string; label: string; icon: LucideIcon };

/**
 * Settings pages (profile, company): a sticky section nav on the left from `lg` (scroll-spy
 * highlights the section in view), with the section cards stacked on the right. On smaller
 * screens the nav is hidden and the sections simply stack.
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
  const [active, setActive] = useState(nav[0]?.id ?? "");

  useEffect(() => {
    const sections = nav
      .map((item) => document.getElementById(item.id))
      .filter((element): element is HTMLElement => element !== null);
    if (sections.length === 0 || typeof IntersectionObserver === "undefined") return;
    const visible = new Map<string, number>();
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) visible.set(entry.target.id, entry.boundingClientRect.top);
          else visible.delete(entry.target.id);
        }
        const first = nav.find((item) => visible.has(item.id));
        if (first) setActive(first.id);
      },
      { rootMargin: "-96px 0px -55% 0px" },
    );
    for (const section of sections) observer.observe(section);
    return () => observer.disconnect();
  }, [nav]);

  return (
    <div className="grid gap-6 lg:grid-cols-[13.5rem_minmax(0,1fr)] lg:gap-10">
      <nav aria-label={label} className="hidden lg:block">
        <ul className="sticky top-24 flex flex-col gap-1">
          {nav.map((item) => {
            const Icon = item.icon;
            const current = active === item.id;
            return (
              <li key={item.id}>
                <a
                  href={`#${item.id}`}
                  aria-current={current ? "location" : undefined}
                  onClick={() => setActive(item.id)}
                  className={cn(
                    "flex h-10 items-center gap-3 rounded-md px-3 text-sm font-medium transition-colors duration-150 focus-ring",
                    current
                      ? "bg-primary-soft text-primary-text"
                      : "text-muted-foreground hover:bg-surface-sunken hover:text-foreground",
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
      <div className="flex min-w-0 flex-col gap-6">{children}</div>
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
