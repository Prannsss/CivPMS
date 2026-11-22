"use client";

import { useCallback, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  ArrowLeft,
  CalendarDays,
  ChartGantt,
  ChartSpline,
  History,
  LayoutDashboard,
  ListTree,
  LogOut,
  PanelLeftClose,
  PanelLeftOpen,
  Settings,
  Users,
  type LucideIcon,
} from "lucide-react";
import { ProjectAvatar } from "@/components/ui/project-color";
import type { DerivedBadge, ProjectStatus } from "@/components/ui/status-badge";
import { SimpleTooltip } from "@/components/ui/tooltip";
import { SIDEBAR_COLLAPSED_COOKIE } from "@/lib/constants";
import { cn } from "@/lib/utils";
import type { SignOutHandler } from "./user-menu";

export type ProjectNavItem = {
  id: string;
  label: string;
  href: string;
  icon: LucideIcon;
  /** Planned for a later phase: links to its "coming next" page and shows a "Soon" tag. */
  soon?: boolean;
  /** Rendered as a non-interactive item. */
  disabled?: boolean;
};

export type ProjectSidebarProject = {
  name: string;
  /** A PROJECT_COLOR_KEYS key. */
  color?: string | null;
  status?: ProjectStatus;
  derivedBadges?: ReadonlyArray<DerivedBadge>;
};

/** Default project navigation (mockup 8 + spec §9). Gantt and S-Curve are "coming next" in Phase 0–1. */
export function getProjectNavItems(projectId: string, basePath = "/projects"): ProjectNavItem[] {
  const base = `${basePath}/${projectId}`;
  return [
    { id: "dashboard", label: "Dashboard", href: base, icon: LayoutDashboard },
    { id: "wbs", label: "Work Breakdown", href: `${base}/wbs`, icon: ListTree },
    { id: "gantt", label: "Gantt Chart", href: `${base}/gantt`, icon: ChartGantt },
    { id: "s-curve", label: "S-Curve", href: `${base}/s-curve`, icon: ChartSpline },
    { id: "calendar", label: "Calendar", href: `${base}/calendar`, icon: CalendarDays },
    { id: "collaborators", label: "Collaborators", href: `${base}/collaborators`, icon: Users },
    { id: "audit", label: "Audit Trail", href: `${base}/audit`, icon: History },
    { id: "settings", label: "Project Settings", href: `${base}/settings`, icon: Settings },
  ];
}

/** Longest href that matches the current path wins (so Dashboard isn't active on every tab). */
export function findActiveNavId(items: ReadonlyArray<ProjectNavItem>, pathname: string | null): string | undefined {
  if (!pathname) return undefined;
  let best: ProjectNavItem | undefined;
  for (const item of items) {
    const matches = pathname === item.href || pathname.startsWith(`${item.href}/`);
    if (matches && (!best || item.href.length > best.href.length)) best = item;
  }
  return best?.id;
}

const sidebarFocus =
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sidebar-fg";

/**
 * Rail labels stay mounted and fade, so nothing re-flows when the rail collapses: icons keep the
 * same x in both states (18 px padding centres a 20 px icon in the 80 px rail) and only the width
 * animates. Labels fade out quickly on collapse and fade in once the rail has mostly opened.
 */
function railLabel(collapsed: boolean) {
  return cn(
    "min-w-0 flex-1 overflow-hidden whitespace-nowrap transition-opacity",
    collapsed ? "opacity-0 duration-100" : "opacity-100 duration-200 delay-150",
  );
}

export type ProjectSidebarProps = {
  project: ProjectSidebarProject;
  items: ReadonlyArray<ProjectNavItem>;
  /** Active item id; derived from the URL when omitted. */
  activeId?: string;
  allProjectsHref?: string;
  signOut: SignOutHandler;
  /** Icon-only rail (lg+ only). */
  collapsed?: boolean;
  onCollapsedChange?: (collapsed: boolean) => void;
  /** Called after a nav link is clicked (closes the mobile sheet). */
  onNavigate?: () => void;
  /** `rail`: sticky desktop panel; `sheet`: inside the mobile drawer. */
  mode?: "rail" | "sheet";
  className?: string;
};

/** Project workspace navigation (mockup 8): blue panel, white active pill, red Logout at the bottom. */
export function ProjectSidebar({
  project,
  items,
  activeId,
  allProjectsHref = "/",
  signOut,
  collapsed = false,
  onCollapsedChange,
  onNavigate,
  mode = "rail",
  className,
}: ProjectSidebarProps) {
  const pathname = usePathname();
  const active = activeId ?? findActiveNavId(items, pathname);
  const isCollapsed = mode === "rail" && collapsed;

  return (
    <div
      data-collapsed={isCollapsed || undefined}
      className={cn("flex h-full min-h-0 flex-col overflow-hidden bg-sidebar-bg text-sidebar-fg", className)}
    >
      {/* Back link */}
      <div className="pt-3 pl-[22px]">
        <SimpleTooltip content="All projects" side="right" disabled={!isCollapsed}>
          <Link
            href={allProjectsHref}
            onClick={onNavigate}
            className={cn(
              "inline-flex h-9 items-center rounded-full px-2.5 text-[13px] font-medium text-sidebar-fg transition-colors hover:bg-sidebar-hover",
              sidebarFocus,
            )}
          >
            <ArrowLeft aria-hidden className="size-4 shrink-0" />
            {/* Width + opacity so the pill closes into a 36 px circle without a jump. */}
            <span
              className={cn(
                "overflow-hidden whitespace-nowrap transition-[max-width,margin,opacity] duration-300 ease-in-out",
                isCollapsed ? "ml-0 max-w-0 opacity-0" : "ml-2 max-w-40 opacity-100",
              )}
            >
              All projects
            </span>
          </Link>
        </SimpleTooltip>
      </div>

      {/* Project identity */}
      <div className="flex items-center gap-3 px-5 pt-4 pb-5">
        <ProjectAvatar
          name={project.name}
          color={project.color}
          size={isCollapsed ? "md" : "lg"}
          className="shrink-0 ring-2 ring-sidebar-fg/40 transition-[width,height,font-size] duration-300 ease-in-out"
        />
        {/* Fixed width in the rail so the name never re-wraps while the width animates.
            Status and badges live in the page header, not here. */}
        <p
          aria-hidden={isCollapsed || undefined}
          className={cn(
            "line-clamp-2 text-base leading-[1.3rem] font-semibold tracking-[-0.01em] break-words transition-opacity",
            mode === "rail" ? "w-[11.5rem] shrink-0" : "min-w-0 flex-1",
            isCollapsed ? "opacity-0 duration-100" : "opacity-100 duration-200 delay-150",
          )}
        >
          {project.name}
        </p>
      </div>

      <div aria-hidden className="mx-4 h-px bg-sidebar-border" />

      {/* Navigation */}
      <nav aria-label="Project" className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
        <ul className="flex flex-col gap-1">
          {items.map((item) => {
            const Icon = item.icon;
            const isActive = item.id === active;
            const isDisabled = item.disabled;
            const inner = (
              <>
                <Icon aria-hidden className="size-5 shrink-0" />
                <span className={railLabel(isCollapsed)}>{item.label}</span>
                {!isCollapsed && item.soon ? (
                  <span
                    className={cn(
                      "rounded-full px-2 py-0.5 text-[10px] leading-4 font-semibold tracking-wide uppercase",
                      isActive
                        ? "bg-sidebar-bg text-sidebar-fg dark:bg-black/30 dark:text-white"
                        : "bg-black/25 text-white dark:bg-sidebar-hover dark:text-sidebar-fg",
                    )}
                  >
                    Soon
                  </span>
                ) : null}
              </>
            );
            const itemClass = cn(
              "flex h-11 w-full items-center gap-3 rounded-md px-[18px] text-[15px] leading-5 font-medium transition-[background-color,color,box-shadow] duration-150",
              sidebarFocus,
              isActive
                ? "bg-sidebar-active-bg text-sidebar-active-fg shadow-sm"
                : "text-sidebar-fg hover:bg-sidebar-hover",
              isDisabled && "cursor-not-allowed opacity-70 hover:bg-transparent",
            );
            const label = item.soon ? `${item.label} (coming soon)` : item.label;
            return (
              <li key={item.id}>
                <SimpleTooltip content={label} side="right" disabled={!isCollapsed}>
                  {isDisabled ? (
                    <span role="link" aria-disabled="true" className={itemClass} tabIndex={-1}>
                      {inner}
                      {item.soon ? <span className="sr-only">(coming soon)</span> : null}
                    </span>
                  ) : (
                    <Link
                      href={item.href}
                      onClick={onNavigate}
                      aria-current={isActive ? "page" : undefined}
                      className={itemClass}
                    >
                      {inner}
                    </Link>
                  )}
                </SimpleTooltip>
              </li>
            );
          })}
        </ul>
      </nav>

      {/* Footer: collapse + logout */}
      <div className="flex flex-col gap-2 px-3 pt-2 pb-3">
        {mode === "rail" && onCollapsedChange ? (
          <SimpleTooltip content={isCollapsed ? "Expand sidebar" : "Collapse sidebar"} side="right" disabled={!isCollapsed}>
            <button
              type="button"
              onClick={() => onCollapsedChange(!collapsed)}
              aria-label={isCollapsed ? "Expand sidebar" : "Collapse sidebar"}
              aria-expanded={!isCollapsed}
              className={cn(
                "flex h-10 w-full items-center gap-3 rounded-md px-[18px] text-[13px] font-medium text-sidebar-fg transition-colors hover:bg-sidebar-hover",
                sidebarFocus,
              )}
            >
              {isCollapsed ? <PanelLeftOpen aria-hidden className="size-5 shrink-0" /> : <PanelLeftClose aria-hidden className="size-5 shrink-0" />}
              <span aria-hidden className={cn(railLabel(isCollapsed), "text-left")}>
                Collapse
              </span>
            </button>
          </SimpleTooltip>
        ) : null}
        <SignOutButton signOut={signOut} collapsed={isCollapsed} />
      </div>
    </div>
  );
}

function SignOutButton({ signOut, collapsed }: { signOut: SignOutHandler; collapsed: boolean }) {
  const className = cn(
    "flex h-11 w-full items-center gap-3 rounded-md bg-danger px-[18px] text-[15px] font-medium text-danger-foreground shadow-xs transition-colors hover:bg-danger-hover",
    sidebarFocus,
  );
  const content = (
    <>
      <LogOut aria-hidden className="size-5 shrink-0" />
      <span className={cn(railLabel(collapsed), "text-left")}>Logout</span>
    </>
  );
  const button =
    "action" in signOut ? (
      <form action={signOut.action} method={typeof signOut.action === "string" ? "post" : undefined}>
        <button type="submit" className={className}>
          {content}
        </button>
      </form>
    ) : (
      <button type="button" onClick={signOut.onSignOut} className={className}>
        {content}
      </button>
    );
  return (
    <SimpleTooltip content="Logout" side="right" disabled={!collapsed}>
      {button}
    </SimpleTooltip>
  );
}


function writeCollapsedCookie(value: boolean) {
  document.cookie = `${SIDEBAR_COLLAPSED_COOKIE}=${value ? "1" : "0"}; path=/; max-age=31536000; samesite=lax`;
}

/**
 * Collapsed state for the desktop rail, per browser. The server renders from the cookie, so a
 * collapsed rail no longer paints expanded and then animates shut after hydration.
 */
export function useSidebarCollapsed(initial = false): [boolean, (value: boolean) => void] {
  const [collapsed, setCollapsed] = useState(initial);

  const update = useCallback((value: boolean) => {
    writeCollapsedCookie(value);
    setCollapsed(value);
  }, []);
  return [collapsed, update];
}
