"use client";

import { useCallback, useSyncExternalStore } from "react";

/**
 * A small per-viewer preference kept in localStorage (e.g. Graph | List). Server render and the
 * first client render use `fallback`, so there is no hydration mismatch; the stored value applies
 * right after hydration. Storage failures (private mode, blocked storage) fall back silently.
 */
const EVENT = "civpms:stored-choice";
/** Fallback when storage is unavailable, so a choice still applies for this page view. */
const memory = new Map<string, string>();

function read(key: string): string | null {
  try {
    return window.localStorage.getItem(key) ?? memory.get(key) ?? null;
  } catch {
    return memory.get(key) ?? null;
  }
}

export function useStoredChoice<T extends string>(
  key: string,
  allowed: ReadonlyArray<T>,
  fallback: T,
): [T, (next: T) => void] {
  const subscribe = useCallback(
    (onChange: () => void) => {
      const handler = (event: Event) => {
        if (event instanceof StorageEvent && event.key !== null && event.key !== key) return;
        onChange();
      };
      window.addEventListener("storage", handler);
      window.addEventListener(EVENT, handler);
      return () => {
        window.removeEventListener("storage", handler);
        window.removeEventListener(EVENT, handler);
      };
    },
    [key],
  );
  const stored = useSyncExternalStore(
    subscribe,
    () => read(key),
    () => null,
  );
  const value = stored !== null && (allowed as ReadonlyArray<string>).includes(stored) ? (stored as T) : fallback;
  const set = useCallback(
    (next: T) => {
      memory.set(key, next);
      try {
        window.localStorage.setItem(key, next);
      } catch {
        // Not persisted across visits; the in-memory copy still applies.
      }
      window.dispatchEvent(new Event(EVENT));
    },
    [key],
  );
  return [value, set];
}
