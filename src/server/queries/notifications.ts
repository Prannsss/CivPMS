import "server-only";

/**
 * Notifications for the top-bar bell (spec §14): the latest in-app notifications and the unread
 * count, read as the signed-in user (RLS: own rows with `in_app = true`).
 */
import { cache } from "react";
import { AppException, toAppError } from "@/lib/errors";
import {
  NOTIFICATION_COLUMNS,
  toNotificationRecord,
  type NotificationFeed,
} from "@/lib/notifications";
import { createClient } from "@/lib/supabase/server";

export type { NotificationFeed, NotificationRecord } from "@/lib/notifications";

/** How many notifications the bell loads (the full list lives on /notifications). */
export const BELL_NOTIFICATION_LIMIT = 15;

function throwReadFailure(error: unknown): never {
  const appError = toAppError(error);
  throw new AppException(appError.code, appError.message, { cause: error });
}

/** Latest `limit` notifications (newest first) plus the total unread count. */
export const getNotificationFeed = cache(async (limit: number = BELL_NOTIFICATION_LIMIT): Promise<NotificationFeed> => {
  const supabase = await createClient();
  const [list, unread] = await Promise.all([
    supabase
      .from("notifications")
      .select(NOTIFICATION_COLUMNS)
      .eq("in_app", true)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(limit),
    supabase.from("notifications").select("id", { count: "exact", head: true }).eq("in_app", true).is("read_at", null),
  ]);
  if (list.error) throwReadFailure(list.error);
  if (unread.error) throwReadFailure(unread.error);

  return {
    items: (list.data ?? []).map(toNotificationRecord),
    unreadCount: unread.count ?? 0,
  };
});
