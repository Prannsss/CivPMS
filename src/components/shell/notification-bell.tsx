"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  Bell,
  BellOff,
  CheckCheck,
  ClipboardCheck,
  FolderKanban,
  Info,
  ListTree,
  MailOpen,
  UserPlus,
  type LucideIcon,
} from "lucide-react";
import type { BadgeTone } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { BUSINESS_TIMEZONE } from "@/lib/constants";
import { cn } from "@/lib/utils";

export type NotificationType = "invitation" | "inspection" | "activity" | "project" | "member" | "system";

export type NotificationItem = {
  id: string;
  type: NotificationType;
  title: string;
  body?: string;
  /** ISO timestamp or Date. */
  createdAt: string | Date;
  read: boolean;
  href?: string;
  projectId?: string | null;
  projectName?: string | null;
  /** Override the tone derived from `type` (e.g. danger for "Project is now Delayed"). */
  tone?: BadgeTone;
};

export type NotificationProjectOption = { id: string; name: string };

export type NotificationBellProps = {
  notifications: ReadonlyArray<NotificationItem>;
  /** Total unread (may exceed the loaded list). Defaults to the unread items in `notifications`. */
  unreadCount?: number;
  /** Enables the per-project filter (spec §14). */
  projects?: ReadonlyArray<NotificationProjectOption>;
  /** Controlled filter: a project id or "all". Uncontrolled when omitted. */
  projectFilter?: string;
  onProjectFilterChange?: (projectId: string) => void;
  onMarkAllRead?: () => void;
  /** Called when an item is opened (mark it read here). */
  onItemSelect?: (item: NotificationItem) => void;
  viewAllHref?: string;
  loading?: boolean;
  /** Reference time for relative timestamps (injectable for tests). */
  now?: Date;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  className?: string;
};

const TYPE_META: Record<NotificationType, { icon: LucideIcon; tone: BadgeTone }> = {
  invitation: { icon: MailOpen, tone: "primary" },
  inspection: { icon: ClipboardCheck, tone: "info" },
  activity: { icon: ListTree, tone: "neutral" },
  project: { icon: FolderKanban, tone: "orange" },
  member: { icon: UserPlus, tone: "success" },
  system: { icon: Info, tone: "neutral" },
};

const toneTile: Record<BadgeTone, string> = {
  neutral: "bg-neutral-soft text-neutral-text",
  primary: "bg-primary-soft text-primary-text",
  info: "bg-info-soft text-info-text",
  success: "bg-success-soft text-success-text",
  warning: "bg-warning-soft text-warning-text",
  orange: "bg-orange-soft text-orange-text",
  danger: "bg-danger-soft text-danger-text",
};

const shortDate = new Intl.DateTimeFormat("en-PH", { day: "numeric", month: "short", timeZone: BUSINESS_TIMEZONE });

/** "now", "5m", "3h", "2d", then "10 Oct". */
export function formatRelativeShort(date: Date, now: Date): string {
  const seconds = Math.max(0, Math.round((now.getTime() - date.getTime()) / 1000));
  if (seconds < 60) return "now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;
  return shortDate.format(date);
}

export function formatUnreadCount(count: number): string {
  return count > 99 ? "99+" : String(count);
}

/** Round bell with unread badge; opens a panel with filter, list, "Mark all as read" and "View all". */
export function NotificationBell({
  notifications,
  unreadCount,
  projects,
  projectFilter,
  onProjectFilterChange,
  onMarkAllRead,
  onItemSelect,
  viewAllHref,
  loading = false,
  now,
  open,
  onOpenChange,
  className,
}: NotificationBellProps) {
  const [internalOpen, setInternalOpen] = useState(false);
  const [internalFilter, setInternalFilter] = useState("all");
  const isOpen = open ?? internalOpen;
  const setOpen = (next: boolean) => {
    setInternalOpen(next);
    onOpenChange?.(next);
  };
  const filter = projectFilter ?? internalFilter;
  const unread = unreadCount ?? notifications.filter((n) => !n.read).length;

  const visible = useMemo(
    () => (filter === "all" ? notifications : notifications.filter((n) => n.projectId === filter)),
    [filter, notifications],
  );
  const reference = now ?? new Date();

  return (
    <Popover open={isOpen} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <IconButton
          aria-label={unread > 0 ? `Notifications, ${unread} unread` : "Notifications"}
          tooltip="Notifications"
          variant="soft"
          className={className}
        >
          <Bell aria-hidden />
          {unread > 0 ? (
            <span
              aria-hidden
              className="absolute -top-1 -right-1 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-danger px-1 text-[11px] leading-none font-semibold text-danger-foreground tabular-nums ring-2 ring-background"
            >
              {formatUnreadCount(unread)}
            </span>
          ) : null}
        </IconButton>
      </PopoverTrigger>
      <PopoverContent align="end" className="flex max-h-(--radix-popover-content-available-height) w-[min(25rem,calc(100vw-1.5rem))] flex-col overflow-hidden p-0">
        <div className="flex shrink-0 items-center justify-between gap-3 px-4 pt-4 pb-3">
          <div className="flex items-center gap-2">
            <h2 className="text-base leading-6 font-semibold">Notifications</h2>
            {unread > 0 ? (
              <span className="inline-flex h-5 items-center rounded-full bg-primary-soft px-2 text-[11px] font-semibold text-primary-text tabular-nums">
                {formatUnreadCount(unread)} new
              </span>
            ) : null}
          </div>
          {onMarkAllRead ? (
            <Button variant="ghost" size="sm" onClick={onMarkAllRead} disabled={unread === 0} className="-mr-2 h-8 px-2.5 text-primary-text">
              <CheckCheck aria-hidden />
              Mark all as read
            </Button>
          ) : null}
        </div>

        {projects && projects.length > 0 ? (
          <div className="shrink-0 px-4 pb-3">
            <Select
              value={filter}
              onValueChange={(value) => {
                setInternalFilter(value);
                onProjectFilterChange?.(value);
              }}
            >
              <SelectTrigger aria-label="Filter by project" className="h-9 rounded-full bg-surface-muted text-[13px] sm:h-9">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All projects</SelectItem>
                {projects.map((project) => (
                  <SelectItem key={project.id} value={project.id}>
                    {project.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        ) : null}

        <div className="max-h-[min(26rem,60dvh)] min-h-0 flex-1 overflow-y-auto border-t border-border">
          {loading ? (
            <ul aria-busy className="flex flex-col">
              {Array.from({ length: 3 }, (_, i) => (
                <li key={i} className="flex gap-3 px-4 py-3.5">
                  <Skeleton className="size-9 rounded-full" />
                  <div className="flex flex-1 flex-col gap-2">
                    <Skeleton className="h-3.5 w-3/4" />
                    <Skeleton className="h-3 w-1/2" />
                  </div>
                </li>
              ))}
            </ul>
          ) : visible.length === 0 ? (
            <div className="flex flex-col items-center gap-2 px-6 py-10 text-center">
              <span aria-hidden className="grid size-11 place-items-center rounded-full bg-surface-sunken text-muted-foreground">
                <BellOff className="size-5" />
              </span>
              <p className="text-sm font-medium text-foreground">You&apos;re all caught up</p>
              <p className="text-[13px] leading-5 text-muted-foreground">
                {filter === "all" ? "New invitations, inspections and alerts will show up here." : "No notifications for this project."}
              </p>
            </div>
          ) : (
            <ul className="flex flex-col py-1">
              {visible.map((item) => (
                <li key={item.id}>
                  <NotificationRow
                    item={item}
                    now={reference}
                    onSelect={() => {
                      onItemSelect?.(item);
                      setOpen(false);
                    }}
                  />
                </li>
              ))}
            </ul>
          )}
        </div>

        {viewAllHref ? (
          <div className="shrink-0 border-t border-border bg-surface-muted p-2">
            <Button asChild variant="ghost" size="sm" className="w-full text-primary-text">
              <Link href={viewAllHref} onClick={() => setOpen(false)}>
                View all notifications
              </Link>
            </Button>
          </div>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}

function NotificationRow({ item, now, onSelect }: { item: NotificationItem; now: Date; onSelect: () => void }) {
  const meta = TYPE_META[item.type];
  const Icon = meta.icon;
  const created = typeof item.createdAt === "string" ? new Date(item.createdAt) : item.createdAt;
  const className = cn(
    "group relative flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-surface-sunken focus-ring-inset",
    !item.read && "bg-primary-soft/40",
  );
  const content = (
    <>
      <span aria-hidden className={cn("mt-0.5 grid size-9 shrink-0 place-items-center rounded-full", toneTile[item.tone ?? meta.tone])}>
        <Icon className="size-4" />
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5 pr-4">
        <span className={cn("text-sm leading-5 text-foreground", item.read ? "font-normal" : "font-semibold")}>
          {item.title}
        </span>
        {item.body ? <span className="line-clamp-2 text-[13px] leading-5 text-muted-foreground">{item.body}</span> : null}
        <span className="mt-0.5 flex items-center gap-1.5 text-xs leading-4 text-muted-foreground">
          {item.projectName ? <span className="truncate font-medium">{item.projectName}</span> : null}
          {item.projectName ? <span aria-hidden>·</span> : null}
          <time dateTime={created.toISOString()} className="shrink-0 tabular-nums">
            {formatRelativeShort(created, now)}
          </time>
        </span>
      </span>
      {!item.read ? (
        <span className="absolute top-4 right-4 size-2 rounded-full bg-primary">
          <span className="sr-only">Unread</span>
        </span>
      ) : null}
    </>
  );

  if (item.href) {
    return (
      <Link href={item.href} onClick={onSelect} className={className}>
        {content}
      </Link>
    );
  }
  return (
    <button type="button" onClick={onSelect} className={className}>
      {content}
    </button>
  );
}
