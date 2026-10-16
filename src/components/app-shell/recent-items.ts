"use client";

import { useCallback, useSyncExternalStore } from "react";

/** A palette entry remembered per browser and user ("Recent" while the query is empty). */
export type RecentItem = {
  id: string;
  label: string;
  hint?: string;
  href: string;
  kind: "project" | "page";
  /** Project color key, for project entries. */
  color?: string;
};

const MAX_RECENT = 6;
const EMPTY: RecentItem[] = [];
const listeners = new Set<() => void>();
const cache = new Map<string, { raw: string | null; items: RecentItem[] }>();

function storageKey(userId: string): string {
  return `civpms:recent:${userId}`;
}

function isRecentItem(value: unknown): value is RecentItem {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.id === "string" &&
    typeof v.label === "string" &&
    typeof v.href === "string" &&
    v.href.startsWith("/") &&
    !v.href.startsWith("//") &&
    (v.kind === "project" || v.kind === "page")
  );
}

function read(userId: string): RecentItem[] {
  const key = storageKey(userId);
  let raw: string | null = null;
  try {
    raw = window.localStorage.getItem(key);
  } catch {
    return EMPTY;
  }
  const cached = cache.get(key);
  if (cached && cached.raw === raw) return cached.items;
  let items: RecentItem[] = EMPTY;
  if (raw) {
    try {
      const parsed: unknown = JSON.parse(raw);
      items = Array.isArray(parsed) ? parsed.filter(isRecentItem).slice(0, MAX_RECENT) : EMPTY;
    } catch {
      items = EMPTY;
    }
  }
  cache.set(key, { raw, items });
  return items;
}

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange);
  window.addEventListener("storage", onChange);
  return () => {
    listeners.delete(onChange);
    window.removeEventListener("storage", onChange);
  };
}

/** Recently opened projects and pages for this user (hydration-safe: empty on the server). */
export function useRecentItems(userId: string): [RecentItem[], (item: RecentItem) => void] {
  const items = useSyncExternalStore(
    subscribe,
    () => read(userId),
    () => EMPTY,
  );
  const remember = useCallback(
    (item: RecentItem) => {
      const next = [item, ...read(userId).filter((existing) => existing.id !== item.id)].slice(0, MAX_RECENT);
      try {
        window.localStorage.setItem(storageKey(userId), JSON.stringify(next));
      } catch {
        // Storage unavailable (private mode): recents simply won't persist.
      }
      listeners.forEach((listener) => listener());
    },
    [userId],
  );
  return [items, remember];
}
