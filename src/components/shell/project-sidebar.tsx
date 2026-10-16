"use client";

import { useCallback, useSyncExternalStore } from "react";
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
import { STATUS_META, type DerivedBadge, type ProjectStatus } from "@/components/ui/status-badge";
import { SimpleTooltip } from "@/components/ui/tooltip";
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
    { id: "gantt", label: "Gantt Chart", href: `${base}/gantt`, icon: ChartGantt, soon: true },
    { id: "s-curve", label: "S-Curve", href: `${base}/s-curve`, icon: ChartSpline, soon: true },
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
  const statusMeta = project.status ? STATUS_META[project.status] : null;

  return (
    <div
      data-collapsed={isCollapsed || undefined}
      className={cn("flex h-full min-h-0 flex-col bg-sidebar-bg text-sidebar-fg", className)}
    >
      {/* Back link */}
      <div className={cn("px-3 pt-3", isCollapsed && "flex justify-center")}>
        <SimpleTooltip content="All projects" side="right" disabled={!isCollapsed}>
          <Link
            href={allProjectsHref}
            onClick={onNavigate}
            aria-label={isCollapsed ? "All projects" : undefined}
            className={cn(
              "inline-flex h-9 items-center gap-2 rounded-full px-3 text-[13px] font-medium text-sidebar-fg transition-colors hover:bg-sidebar-hover",
              isCollapsed && "w-9 justify-center px-0",
              sidebarFocus,
            )}
          >
            <ArrowLeft aria-hidden className="size-4 shrink-0" />
            {isCollapsed ? null : "All projects"}
          </Link>
        </SimpleTooltip>
      </div>

      {/* Project identity */}
      <div className={cn("flex items-center gap-3 px-5 pt-4 pb-5", isCollapsed && "justify-center px-0")}>
        <ProjectAvatar
          name={project.name}
          color={project.color}
          size={isCollapsed ? "md" : "lg"}
          className="ring-2 ring-sidebar-fg/40"
        />
        {isCollapsed ? null : (
          <div className="flex min-w-0 flex-col gap-1.5">
            <p className="line-clamp-2 text-base leading-[1.3rem] font-semibold tracking-[-0.01em] break-words">{project.name}</p>
            {statusMeta || (project.derivedBadges && project.derivedBadges.length > 0) ? (
              <div className="flex flex-wrap gap-1">
                {statusMeta ? <SidebarBadge label={statusMeta.label} icon={statusMeta.icon} /> : null}
                {project.derivedBadges?.map((badge) => (
                  <SidebarBadge key={badge} label={STATUS_META[badge].label} icon={STATUS_META[badge].icon} alert />
                ))}
              </div>
            ) : null}
          </div>
        )}
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
                {isCollapsed ? null : <span className="min-w-0 flex-1 truncate">{item.label}</span>}
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
              "flex h-11 w-full items-center gap-3 rounded-md px-3.5 text-[15px] leading-5 font-medium transition-[background-color,color,box-shadow] duration-150",
              isCollapsed && "justify-center px-0",
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
                    <span role="link" aria-disabled="true" aria-label={isCollapsed ? label : undefined} className={itemClass} tabIndex={-1}>
                      {inner}
                      {isCollapsed || !item.soon ? null : <span className="sr-only">(coming soon)</span>}
                    </span>
                  ) : (
                    <Link
                      href={item.href}
                      onClick={onNavigate}
                      aria-current={isActive ? "page" : undefined}
                      aria-label={isCollapsed ? label : undefined}
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
                "flex h-10 w-full items-center gap-3 rounded-md px-3.5 text-[13px] font-medium text-sidebar-fg transition-colors hover:bg-sidebar-hover",
                isCollapsed && "justify-center px-0",
                sidebarFocus,
              )}
            >
              {isCollapsed ? <PanelLeftOpen aria-hidden className="size-5" /> : <PanelLeftClose aria-hidden className="size-5" />}
              {isCollapsed ? null : "Collapse"}
            </button>
          </SimpleTooltip>
        ) : null}
        <SignOutButton signOut={signOut} collapsed={isCollapsed} />
      </div>
    </div>
  );
}

function SidebarBadge({ label, icon: Icon, alert = false }: { label: string; icon: LucideIcon; alert?: boolean }) {
  return (
    <span
      className={cn(
        "inline-flex h-6 items-center gap-1 rounded-full px-2 text-[11px] leading-4 font-semibold",
        alert
          ? "bg-danger text-danger-foreground"
          : "bg-black/25 text-white dark:bg-sidebar-hover dark:text-sidebar-fg",
      )}
    >
      <Icon aria-hidden className="size-3.5" strokeWidth={2.25} />
      {label}
    </span>
  );
}

function SignOutButton({ signOut, collapsed }: { signOut: SignOutHandler; collapsed: boolean }) {
  const className = cn(
    "flex h-11 w-full items-center gap-3 rounded-md bg-danger px-3.5 text-[15px] font-medium text-danger-foreground shadow-xs transition-colors hover:bg-danger-hover",
    collapsed && "justify-center px-0",
    sidebarFocus,
  );
  const content = (
    <>
      <LogOut aria-hidden className="size-5 shrink-0" />
      {collapsed ? <span className="sr-only">Log out</span> : "Log out"}
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
    <SimpleTooltip content="Log out" side="right" disabled={!collapsed}>
      {button}
    </SimpleTooltip>
  );
}

const collapseListeners = new Set<() => void>();

function readCollapsed(storageKey: string): boolean {
  try {
    return window.localStorage.getItem(storageKey) === "1";
  } catch {
    return false;
  }
}

/** Persisted collapsed state for the desktop rail (per browser, hydration-safe). */
export function useSidebarCollapsed(storageKey = "civpms:sidebar-collapsed"): [boolean, (value: boolean) => void] {
  const collapsed = useSyncExternalStore(
    (onChange) => {
      collapseListeners.add(onChange);
      window.addEventListener("storage", onChange);
      return () => {
        collapseListeners.delete(onChange);
        window.removeEventListener("storage", onChange);
      };
    },
    () => readCollapsed(storageKey),
    () => false,
  );
  const update = useCallback(
    (value: boolean) => {
      try {
        window.localStorage.setItem(storageKey, value ? "1" : "0");
      } catch {
        // Storage unavailable (private mode): the toggle simply won't persist.
      }
      collapseListeners.forEach((listener) => listener());
    },
    [storageKey],
  );
  return [collapsed, update];
}
