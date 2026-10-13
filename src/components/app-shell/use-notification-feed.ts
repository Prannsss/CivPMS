"use client";

import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { toast } from "@/components/ui/toaster";
import {
  NOTIFICATION_COLUMNS,
  isNotificationRow,
  normalizeTimestamp,
  toNotificationRecord,
  type NotificationFeed,
  type NotificationRecord,
} from "@/lib/notifications";
import { createClient } from "@/lib/supabase/client";
import { markNotificationsRead } from "@/server/actions/notifications";
import { feedFromSnapshot, feedReducer, newestCreatedAt, unreadIds, type FeedState } from "./notification-feed-state";

export type UseNotificationFeedOptions = {
  /** Server snapshot (latest notifications + unread count). A new object resets the feed. */
  initial: NotificationFeed;
  userId: string;
  /** Called with the notifications that arrived live (after they are added to the feed). */
  onInsert?: (records: NotificationRecord[]) => void;
};

export type NotificationFeedApi = FeedState & {
  /** True once the Realtime subscription is active (new notifications arrive without a reload). */
  live: boolean;
  /** Optimistically marks the given ids read; reverts with a snackbar if the server refuses. */
  markRead: (ids: readonly string[]) => Promise<void>;
  markAllRead: () => Promise<void>;
};

/** How many recent notifications a catch-up reads after (re)subscribing. */
const CATCH_UP_LIMIT = 20;

/**
 * The bell's live state: starts from the server snapshot, receives new notifications through
 * Supabase Realtime (`postgres_changes` on `notifications`, filtered to the user; RLS applies),
 * syncs read marks made in other tabs, and marks read optimistically.
 *
 * Every time the channel (re)subscribes it also reads the newest notifications once, so nothing
 * created between the server render (or a dropped connection) and the subscription is missed.
 */
export function useNotificationFeed({ initial, userId, onInsert }: UseNotificationFeedOptions): NotificationFeedApi {
  const [state, dispatch] = useReducer(feedReducer, initial, feedFromSnapshot);
  const [live, setLive] = useState(false);

  // A router refresh brings a new server snapshot: adopt it (adjusting state while rendering,
  // as React recommends for "reset when a prop changes").
  const [snapshot, setSnapshot] = useState(initial);
  if (snapshot !== initial) {
    setSnapshot(initial);
    dispatch({ type: "reset", feed: initial });
  }

  const stateRef = useRef(state);
  const onInsertRef = useRef(onInsert);
  useEffect(() => {
    stateRef.current = state;
    onInsertRef.current = onInsert;
  });

  useEffect(() => {
    const supabase = createClient();
    const filter = `user_id=eq.${userId}`;
    let channel: RealtimeChannel | null = null;
    let cancelled = false;

    /** Adds records the feed doesn't know yet and reports them once. */
    const receive = (records: NotificationRecord[]) => {
      const known = new Set(stateRef.current.items.map((item) => item.id));
      const fresh = records.filter((record) => !known.has(record.id));
      if (fresh.length === 0) return;
      for (const record of fresh) dispatch({ type: "insert", record });
      // Keep the ref current until React re-renders, so a burst never reports a record twice.
      stateRef.current = fresh.reduce(
        (current, record) => feedReducer(current, { type: "insert", record }),
        stateRef.current,
      );
      onInsertRef.current?.(fresh);
    };

    const catchUp = async () => {
      const since = newestCreatedAt(stateRef.current);
      let query = supabase
        .from("notifications")
        .select(NOTIFICATION_COLUMNS)
        .eq("in_app", true)
        .order("created_at", { ascending: false })
        .order("id", { ascending: false })
        .limit(CATCH_UP_LIMIT);
      if (since) query = query.gte("created_at", since);
      const { data, error } = await query;
      if (cancelled || error || !data) return;
      receive(data.map(toNotificationRecord).reverse());
    };

    // Join with the user's access token: postgres_changes checks RLS and column privileges
    // when the channel joins, and a join made before the session loads would run as anon.
    void supabase.realtime.setAuth().then(() => {
      if (cancelled) return;
      channel = supabase
        .channel(`notifications:${userId}`, {
          config: { postgres_changes_options: { wait: true } },
        })
        .on("postgres_changes", { event: "INSERT", schema: "public", table: "notifications", filter }, (payload) => {
          const row: unknown = payload.new;
          if (!isNotificationRow(row) || row.in_app === false) return;
          receive([toNotificationRecord(row)]);
        })
        .on("postgres_changes", { event: "UPDATE", schema: "public", table: "notifications", filter }, (payload) => {
          const row: unknown = payload.new;
          if (!isNotificationRow(row) || !row.read_at) return;
          dispatch({
            type: "markRead",
            ids: [row.id],
            at: normalizeTimestamp(row.read_at),
          });
        })
        .subscribe((status) => {
          if (cancelled) return;
          if (status === "SUBSCRIBED") {
            setLive(true);
            void catchUp();
          } else {
            setLive(false);
          }
        });
    });

    return () => {
      cancelled = true;
      setLive(false);
      if (channel) void supabase.removeChannel(channel);
    };
  }, [userId]);

  const markRead = useCallback(async (ids: readonly string[]) => {
    const current = stateRef.current;
    const pending = ids.filter((id) => current.items.some((item) => item.id === id && item.readAt === null));
    if (pending.length === 0) return;
    const before = current.unreadCount;
    dispatch({ type: "markRead", ids: pending, at: new Date().toISOString() });
    const result = await markNotificationsRead({ ids: pending });
    if (!result.ok) {
      dispatch({ type: "revert", ids: pending, unreadCount: before });
      toast.error("Couldn't mark that as read", {
        description: result.error.message,
      });
    }
  }, []);

  const markAllRead = useCallback(async () => {
    const current = stateRef.current;
    if (current.unreadCount === 0 && unreadIds(current).length === 0) return;
    const pending = unreadIds(current);
    const before = current.unreadCount;
    dispatch({ type: "markAllRead", at: new Date().toISOString() });
    const result = await markNotificationsRead({});
    if (!result.ok) {
      dispatch({ type: "revert", ids: pending, unreadCount: before });
      toast.error("Couldn't mark notifications as read", {
        description: result.error.message,
      });
    }
  }, []);

  return { ...state, live, markRead, markAllRead };
}
