"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  BellOff,
  Check,
  CheckCheck,
  ClipboardCheck,
  FolderKanban,
  Inbox,
  Info,
  ListTree,
  MailOpen,
  Settings2,
  UserPlus,
  type LucideIcon,
} from "lucide-react";
import { presentNotification } from "@/components/app-shell/notification-items";
import type { NotificationType } from "@/components/shell/notification-bell";
import type { BadgeTone } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { IconButton } from "@/components/ui/icon-button";
import { PageHeader } from "@/components/ui/page-header";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "@/components/ui/toaster";
import { formatDateTime, formatRelativeTime, pluralize } from "@/lib/domain/format";
import type { NotificationRecord } from "@/lib/notifications";
import { cn } from "@/lib/utils";
import { loadOlderNotifications } from "@/app/(app)/(home)/notifications/actions";
import { markNotificationsRead } from "@/server/actions/notifications";
import type { NotificationsFilter, NotificationsOverview, NotificationsPage } from "@/server/queries/notifications-page";
import { groupByDay, mergePages, notificationsHref } from "./notification-groups";

const TYPE_ICON: Record<NotificationType, LucideIcon> = {
  invitation: MailOpen,
  inspection: ClipboardCheck,
  activity: ListTree,
  project: FolderKanban,
  member: UserPlus,
  system: Info,
};

const TONE_TILE: Record<BadgeTone, string> = {
  neutral: "bg-neutral-soft text-neutral-text",
  primary: "bg-primary-soft text-primary-text",
  info: "bg-info-soft text-info-text",
  success: "bg-success-soft text-success-text",
  warning: "bg-warning-soft text-warning-text",
  orange: "bg-orange-soft text-orange-text",
  danger: "bg-danger-soft text-danger-text",
};

const DEFAULT_TONE: Record<NotificationType, BadgeTone> = {
  invitation: "primary",
  inspection: "info",
  activity: "neutral",
  project: "orange",
  member: "success",
  system: "neutral",
};

/**
 * The full notifications list (spec §14): day groups, icon by type, unread dot, project chip,
 * relative time, All/Unread and project filters (in the URL, so they deep-link), mark one or all
 * read, and "Show older" keyset pagination.
 */
export function NotificationsView({
  page,
  filter,
  overview,
  now: serverNow,
}: {
  page: NotificationsPage;
  filter: NotificationsFilter;
  overview: NotificationsOverview;
  /** Server time of the render, so relative times match during hydration. */
  now: string;
}) {
  const router = useRouter();
  const [now, setNow] = useState(() => new Date(serverNow));
  const [older, setOlder] = useState<NotificationRecord[]>([]);
  const [olderCursor, setOlderCursor] = useState<string | null | undefined>(undefined);
  const [readIds, setReadIds] = useState<ReadonlySet<string>>(new Set());
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [markingAll, setMarkingAll] = useState(false);

  useEffect(() => {
    const tick = () => setNow(new Date());
    const timer = window.setInterval(tick, 60_000);
    const first = window.setTimeout(tick, 0);
    return () => {
      window.clearInterval(timer);
      window.clearTimeout(first);
    };
  }, []);

  const items = useMemo(
    () => mergePages(page.items, older).map((item) => (readIds.has(item.id) && !item.readAt ? { ...item, readAt: now.toISOString() } : item)),
    [page.items, older, readIds, now],
  );
  const nextCursor = olderCursor === undefined ? page.nextCursor : olderCursor;
  const groups = useMemo(() => groupByDay(items, now), [items, now]);
  const locallyRead = page.items.filter((item) => !item.readAt && readIds.has(item.id)).length;
  const unreadCount = Math.max(0, overview.unreadCount - locallyRead);
  const filtered = filter.unread || filter.projectId !== null;
  const projectName = overview.projects.find((project) => project.id === filter.projectId)?.name ?? null;

  function navigate(next: NotificationsFilter) {
    router.push(notificationsHref(next), { scroll: false });
  }

  async function markRead(ids: string[]) {
    if (ids.length === 0) return;
    setReadIds((current) => new Set([...current, ...ids]));
    const result = await markNotificationsRead({ ids });
    if (!result.ok) {
      setReadIds((current) => new Set([...current].filter((id) => !ids.includes(id))));
      toast.error("Couldn't mark as read", { description: result.error.message });
    }
  }

  async function markAll() {
    const unreadLoaded = items.filter((item) => !item.readAt).map((item) => item.id);
    setMarkingAll(true);
    // With a project filter only that project's loaded notifications are marked.
    const result = await markNotificationsRead(filter.projectId ? { ids: unreadLoaded.slice(0, 200) } : {});
    setMarkingAll(false);
    if (!result.ok) {
      toast.error("Couldn't mark notifications as read", { description: result.error.message });
      return;
    }
    setReadIds((current) => new Set([...current, ...unreadLoaded]));
    toast.success(result.data.marked > 0 ? `Marked ${pluralize(result.data.marked, "notification")} as read` : "Everything was already read");
    router.refresh();
  }

  async function showOlder() {
    if (!nextCursor) return;
    setLoadingOlder(true);
    const result = await loadOlderNotifications({
      filter: filter.unread ? "unread" : "all",
      project: filter.projectId,
      cursor: nextCursor,
    });
    setLoadingOlder(false);
    if (!result.ok) {
      toast.error("Couldn't load older notifications", { description: result.error.message });
      return;
    }
    setOlder((current) => [...current, ...result.data.items]);
    setOlderCursor(result.data.nextCursor);
  }

  const description =
    overview.totalCount === 0
      ? "Invitations, project alerts and team changes"
      : `${unreadCount > 0 ? `${pluralize(unreadCount, "unread notification")}` : "All caught up"} · ${pluralize(overview.totalCount, "notification")} in total`;

  return (
    <div className="flex flex-col">
      <PageHeader
        title="Notifications"
        description={description}
        actions={
          <>
            <Button variant="ghost" asChild className="text-muted-foreground">
              <Link href="/profile#notifications">
                <Settings2 aria-hidden />
                Settings
              </Link>
            </Button>
            <Button variant="outline" onClick={() => void markAll()} loading={markingAll} disabled={unreadCount === 0 || markingAll}>
              <CheckCheck aria-hidden />
              Mark all as read
            </Button>
          </>
        }
      />

      {overview.totalCount > 0 ? (
        <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <SegmentedControl
            aria-label="Show"
            value={filter.unread ? "unread" : "all"}
            onValueChange={(value) => navigate({ ...filter, unread: value === "unread" })}
            options={[
              { value: "all", label: "All" },
              { value: "unread", label: unreadCount > 0 ? `Unread · ${unreadCount > 99 ? "99+" : unreadCount}` : "Unread" },
            ]}
          />
          {overview.projects.length > 0 ? (
            <Select value={filter.projectId ?? "all"} onValueChange={(value) => navigate({ ...filter, projectId: value === "all" ? null : value })}>
              <SelectTrigger aria-label="Filter by project" className="w-full rounded-full sm:w-72">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All projects</SelectItem>
                {overview.projects.map((project) => (
                  <SelectItem key={project.id} value={project.id}>
                    {project.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : null}
        </div>
      ) : null}

      {items.length === 0 ? (
        overview.totalCount === 0 ? (
          <EmptyState
            icon={<Inbox />}
            title="No notifications yet"
            description="Invitations, project alerts (Delayed, over budget) and team changes will show up here and on the bell."
            action={
              <Button variant="outline" asChild>
                <Link href="/profile#notifications">Choose what you&apos;re notified about</Link>
              </Button>
            }
          />
        ) : filter.unread && !filter.projectId ? (
          <EmptyState
            icon={<BellOff />}
            title="You're all caught up"
            description="No unread notifications. New ones also appear on the bell at the top."
            action={
              <Button variant="outline" onClick={() => navigate({ unread: false, projectId: null })}>
                Show all notifications
              </Button>
            }
          />
        ) : (
          <EmptyState
            icon={<BellOff />}
            title={filter.unread ? "Nothing unread for this project" : "No notifications for this project"}
            description={projectName ? `Nothing to show for ${projectName} with these filters.` : "Nothing matches these filters."}
            action={
              <Button variant="outline" onClick={() => navigate({ unread: false, projectId: null })}>
                Clear filters
              </Button>
            }
          />
        )
      ) : (
        <div className="overflow-hidden rounded-lg border border-border bg-surface shadow-xs">
          {groups.map((group, groupIndex) => (
            <section key={group.key} aria-labelledby={`day-${group.key}`} className={cn(groupIndex > 0 && "border-t border-border")}>
              <h2
                id={`day-${group.key}`}
                className="bg-surface-muted px-5 py-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase sm:px-6"
              >
                {group.label}
              </h2>
              <ul className="flex flex-col divide-y divide-border border-t border-border">
                {group.items.map((item) => (
                  <li key={item.id}>
                    <NotificationRow item={item} now={now} onRead={() => void markRead([item.id])} />
                  </li>
                ))}
              </ul>
            </section>
          ))}
          <div className="flex flex-col items-center gap-2 border-t border-border bg-surface-muted px-5 py-4 text-center">
            {nextCursor ? (
              <Button variant="outline" onClick={() => void showOlder()} loading={loadingOlder} loadingText="Loading…">
                Show older notifications
              </Button>
            ) : (
              <p className="text-[13px] text-muted-foreground">
                {filtered ? "That's everything for these filters." : "You've reached your first notification."}
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function NotificationRow({ item, now, onRead }: { item: NotificationRecord; now: Date; onRead: () => void }) {
  const { type, tone } = presentNotification(item);
  const Icon = TYPE_ICON[type];
  const unread = item.readAt === null;
  const content = (
    <>
      <span aria-hidden className={cn("mt-0.5 grid size-10 shrink-0 place-items-center rounded-full", TONE_TILE[tone ?? DEFAULT_TONE[type]])}>
        <Icon className="size-[18px]" />
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-1">
        <span className={cn("text-sm leading-5 text-foreground", unread ? "font-semibold" : "font-medium")}>{item.title}</span>
        {item.body ? <span className="line-clamp-2 text-[13px] leading-5 text-muted-foreground">{item.body}</span> : null}
        <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs leading-4 text-muted-foreground">
          {item.projectName ? (
            <span className="inline-flex max-w-full items-center gap-1 rounded-full border border-border bg-surface-muted px-2 py-0.5 font-medium text-foreground/80">
              <FolderKanban aria-hidden className="size-3 shrink-0" />
              <span className="truncate">{item.projectName}</span>
            </span>
          ) : null}
          <time dateTime={item.createdAt} title={formatDateTime(item.createdAt)} className="tabular-nums">
            {formatRelativeTime(item.createdAt, now)}
          </time>
        </span>
      </span>
    </>
  );
  const rowClass = "flex min-w-0 flex-1 items-start gap-3.5 rounded-md py-0.5 text-left focus-ring";

  return (
    <div
      data-testid="notification-row"
      data-unread={unread ? "true" : "false"}
      className={cn("group relative flex items-start gap-2 px-5 py-4 transition-colors hover:bg-surface-sunken/60 sm:px-6", unread && "bg-primary-soft/35")}
    >
      {item.link ? (
        <Link href={item.link} className={rowClass} onClick={() => unread && onRead()}>
          {content}
        </Link>
      ) : (
        <div className={rowClass}>{content}</div>
      )}
      <div className="flex shrink-0 items-center gap-1 self-center">
        {unread ? (
          <>
            <span className="size-2.5 rounded-full bg-primary" aria-hidden />
            <span className="sr-only">Unread</span>
            <IconButton
              variant="ghost"
              size="sm"
              tooltip="Mark as read"
              aria-label={`Mark “${item.title}” as read`}
              onClick={onRead}
              className="max-sm:size-11"
            >
              <Check aria-hidden />
            </IconButton>
          </>
        ) : (
          <span className="size-9 max-sm:size-11" aria-hidden />
        )}
      </div>
    </div>
  );
}
