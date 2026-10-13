"use client";

import { useEffect, useMemo, useRef } from "react";
import { useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import { Bell, Building2, FolderOpen, FolderPlus, History, LogOut, SunMoon, UserRound } from "lucide-react";
import { ProjectAvatar } from "@/components/ui/project-color";
import { STATUS_META } from "@/components/ui/status-badge";
import { toast } from "@/components/ui/toaster";
import type { CommandPaletteGroup, CommandPaletteItem, CommandPaletteProps } from "@/components/shell/command-palette";
import type { NotificationBellProps, NotificationProjectOption } from "@/components/shell/notification-bell";
import type { ProjectNavItem } from "@/components/shell/project-sidebar";
import type { UserMenuProps } from "@/components/shell/user-menu";
import type { NotificationRecord } from "@/lib/notifications";
import { isAlertNotification, toBellItem } from "./notification-items";
import { useRecentItems, type RecentItem } from "./recent-items";
import type { PaletteProject, ShellData } from "./types";
import { useNotificationFeed } from "./use-notification-feed";

export const SIGN_OUT_PATH = "/auth/signout";
export const NOTIFICATIONS_PATH = "/notifications";
export const PROFILE_PATH = "/profile";
export const COMPANY_SETTINGS_PATH = "/settings";
export const NEW_PROJECT_PATH = "/?new=1";

/** What the palette finds (short enough for a phone-width input). */
const SEARCH_PLACEHOLDER = "Search projects, pages and actions…";

/** Live notifications beyond this many in one burst are not toasted (the bell lists them). */
const MAX_LIVE_TOASTS = 3;

export type ProjectPaletteContext = {
  projectId: string;
  projectName: string;
  /** The sidebar items (already filtered by permission). */
  navItems: ReadonlyArray<ProjectNavItem>;
};

export type ConnectedShell = {
  notifications: NotificationBellProps;
  user: UserMenuProps;
  palette: Omit<CommandPaletteProps, "open" | "onOpenChange">;
  /** Text of the top bar's search pill (what the palette can actually find). */
  searchPlaceholder: string;
  /** True once new notifications arrive live (Realtime subscribed). */
  live: boolean;
  /** Adds an entry to the palette's "Recent" list. */
  rememberRecent: (item: RecentItem) => void;
};

/** Same-origin POST to /auth/signout (a GET could be triggered by prefetching). */
function submitSignOut() {
  const form = document.createElement("form");
  form.method = "post";
  form.action = SIGN_OUT_PATH;
  form.hidden = true;
  document.body.appendChild(form);
  form.submit();
}

function projectHint(project: PaletteProject): string {
  const parts: string[] = [STATUS_META[project.status].label];
  if (project.isDelayed) parts.push("Delayed");
  if (project.budgetState === "exceeded") parts.push("Budget exceeded");
  else if (project.budgetState === "near") parts.push("Near budget limit");
  if (project.isArchived) parts.push("Archived");
  if (project.siteName) parts.push(project.siteName);
  return parts.join(" · ");
}

function notificationProjects(
  items: ReadonlyArray<NotificationRecord>,
  names: ReadonlyMap<string, string>,
): NotificationProjectOption[] {
  const seen = new Map<string, string>();
  for (const item of items) {
    if (!item.projectId || seen.has(item.projectId)) continue;
    const name = names.get(item.projectId) ?? item.projectName;
    if (name) seen.set(item.projectId, name);
  }
  return [...seen].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Wires the presentational top bar to live data: the Realtime bell (optimistic mark-read, toast on
 * new notifications), the user menu (role-aware settings link, POST sign-out) and the ⌘K palette
 * (projects, navigation, actions, recent items).
 */
export function useConnectedShell(data: ShellData, project?: ProjectPaletteContext): ConnectedShell {
  const router = useRouter();
  const { resolvedTheme, setTheme } = useTheme();
  const { viewer, projects } = data;
  const [recent, rememberRecent] = useRecentItems(viewer.id);

  const projectNames = useMemo(() => new Map(projects.map((p) => [p.id, p.name])), [projects]);

  // Live notifications may change memberships, invitations and project badges: refresh the
  // server data once per burst instead of once per notification.
  const refreshTimer = useRef<number | null>(null);
  useEffect(
    () => () => {
      if (refreshTimer.current !== null) window.clearTimeout(refreshTimer.current);
    },
    [],
  );

  const feed = useNotificationFeed({
    initial: data.notifications,
    userId: viewer.id,
    onInsert: (records) => {
      // A burst (e.g. after reconnecting) shows the newest few; the bell has the rest.
      for (const record of records.slice(-MAX_LIVE_TOASTS)) {
        const show = isAlertNotification(record.type) ? toast.warning : toast.info;
        const link = record.link;
        show(record.title, {
          description: record.body ?? undefined,
          action: link
            ? {
                label: "View",
                onClick: () => {
                  void feed.markRead([record.id]);
                  router.push(link);
                },
              }
            : undefined,
        });
      }
      if (refreshTimer.current !== null) window.clearTimeout(refreshTimer.current);
      refreshTimer.current = window.setTimeout(() => {
        refreshTimer.current = null;
        router.refresh();
      }, 300);
    },
  });

  const notifications: NotificationBellProps = {
    notifications: feed.items.map((record) => toBellItem(record, projectNames)),
    unreadCount: feed.unreadCount,
    projects: notificationProjects(feed.items, projectNames),
    onMarkAllRead: () => void feed.markAllRead(),
    onItemSelect: (item) => {
      if (!item.read) void feed.markRead([item.id]);
    },
    viewAllHref: NOTIFICATIONS_PATH,
  };

  const isOwner = viewer.company?.role === "owner_pm";
  const user: UserMenuProps = {
    user: {
      name: viewer.name,
      email: viewer.email,
      avatarUrl: viewer.avatarUrl,
      subtitle: viewer.company ? `${viewer.company.roleLabel} · ${viewer.company.name}` : "No company yet",
    },
    signOut: { action: SIGN_OUT_PATH },
    profileHref: PROFILE_PATH,
    settingsHref: isOwner ? COMPANY_SETTINGS_PATH : null,
    settingsLabel: "Company settings",
  };

  const go = (href: string, recentItem?: RecentItem) => () => {
    if (recentItem) rememberRecent(recentItem);
    router.push(href);
  };

  const groups: CommandPaletteGroup[] = [];

  if (project) {
    groups.push({
      id: "this-project",
      heading: project.projectName,
      items: project.navItems.map((item) => {
        const Icon = item.icon;
        return {
          id: `nav:${item.id}`,
          label: item.label,
          hint: item.soon ? "Coming next" : "This project",
          icon: <Icon />,
          keywords: [project.projectName, "go to", item.id.replace("-", " ")],
          onSelect: go(item.href),
        } satisfies CommandPaletteItem;
      }),
    });
  }

  groups.push({
    id: "projects",
    heading: "Projects",
    items: projects.map((p) => {
      const href = `/projects/${p.id}`;
      return {
        id: `project:${p.id}`,
        label: p.name,
        hint: projectHint(p),
        icon: <ProjectAvatar name={p.name} color={p.color} size="sm" className="size-8" />,
        keywords: [p.siteName ?? "", STATUS_META[p.status].label, "project"],
        onSelect: go(href, {
          id: `project:${p.id}`,
          label: p.name,
          hint: p.siteName ?? undefined,
          href,
          kind: "project",
          color: p.color,
        }),
      } satisfies CommandPaletteItem;
    }),
  });

  const pages: CommandPaletteItem[] = [
    {
      id: "page:home",
      label: "All projects",
      hint: "Home",
      icon: <FolderOpen />,
      keywords: ["home", "projects", "dashboard"],
      onSelect: go("/"),
    },
    {
      id: "page:notifications",
      label: "Notifications",
      hint: feed.unreadCount > 0 ? `${feed.unreadCount} unread` : "All caught up",
      icon: <Bell />,
      keywords: ["alerts", "inbox", "bell"],
      onSelect: go(NOTIFICATIONS_PATH, {
        id: "page:notifications",
        label: "Notifications",
        href: NOTIFICATIONS_PATH,
        kind: "page",
      }),
    },
    {
      id: "page:profile",
      label: "Profile",
      hint: "Name, photo and preferences",
      icon: <UserRound />,
      keywords: ["account", "avatar", "name", "me"],
      onSelect: go(PROFILE_PATH, {
        id: "page:profile",
        label: "Profile",
        href: PROFILE_PATH,
        kind: "page",
      }),
    },
  ];
  if (isOwner) {
    pages.push({
      id: "page:company-settings",
      label: "Company settings",
      hint: viewer.company?.name,
      icon: <Building2 />,
      keywords: ["settings", "company", "invite codes", "members", "working days"],
      onSelect: go(COMPANY_SETTINGS_PATH, {
        id: "page:company-settings",
        label: "Company settings",
        href: COMPANY_SETTINGS_PATH,
        kind: "page",
      }),
    });
  }
  groups.push({ id: "go", heading: "Go to", items: pages });

  const actions: CommandPaletteItem[] = [];
  if (viewer.permissions.canCreateProject) {
    actions.push({
      id: "action:new-project",
      label: "New project",
      hint: "Name, dates and budget",
      icon: <FolderPlus />,
      keywords: ["create project", "add project"],
      onSelect: go(NEW_PROJECT_PATH),
    });
  }
  actions.push(
    {
      id: "action:toggle-theme",
      label: resolvedTheme === "dark" ? "Switch to light theme" : "Switch to dark theme",
      hint: "Theme",
      icon: <SunMoon />,
      keywords: ["theme", "dark mode", "light mode", "appearance"],
      onSelect: () => setTheme(resolvedTheme === "dark" ? "light" : "dark"),
    },
    {
      id: "action:sign-out",
      label: "Sign out",
      hint: viewer.email,
      icon: <LogOut />,
      keywords: ["log out", "logout", "sign off"],
      onSelect: submitSignOut,
    },
  );
  groups.push({ id: "actions", heading: "Actions", items: actions });

  const recentItems: CommandPaletteItem[] = recent
    .filter((item) => item.kind !== "project" || projectNames.has(item.id.replace(/^project:/, "")))
    .map((item) => ({
      id: item.id,
      label: item.kind === "project" ? (projectNames.get(item.id.replace(/^project:/, "")) ?? item.label) : item.label,
      hint: item.hint ?? (item.kind === "project" ? "Project" : "Page"),
      icon:
        item.kind === "project" ? (
          <ProjectAvatar name={item.label} color={item.color} size="sm" className="size-8" />
        ) : (
          <History />
        ),
      onSelect: go(item.href, item),
    }));

  return {
    notifications,
    user,
    palette: {
      groups,
      recent: recentItems,
      placeholder: SEARCH_PLACEHOLDER,
    },
    searchPlaceholder: SEARCH_PLACEHOLDER,
    live: feed.live,
    rememberRecent,
  };
}
