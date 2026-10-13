"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { Check, Copy, RotateCw, ServerCrash, WifiOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { StatusPage, StatusPanel } from "./status-page";

export type RouteErrorProps = {
  error: Error & { digest?: string };
  /** Next's `retry()`: re-fetches and re-renders the segment. */
  retry: () => void;
  /** `inline`: inside an app shell; `page`: standalone (no shell around it). */
  variant?: "inline" | "page";
  homeHref?: string;
  homeLabel?: string;
};

function subscribeOnline(onChange: () => void) {
  window.addEventListener("online", onChange);
  window.addEventListener("offline", onChange);
  return () => {
    window.removeEventListener("online", onChange);
    window.removeEventListener("offline", onChange);
  };
}

/** Short id shown to the user; server errors use Next's digest (it is in the server log). */
function useReferenceId(error: Error & { digest?: string }): string {
  const [clientId] = useState(() =>
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID().slice(0, 8).toUpperCase()
      : Math.random().toString(16).slice(2, 10).toUpperCase(),
  );
  return error.digest ? error.digest.slice(0, 12).toUpperCase() : clientId;
}

/**
 * Error boundary body (spec §17.2): "Something went wrong" + Try again + a reference id that
 * matches the server log. Raw error text is never shown.
 */
export function RouteError({
  error,
  retry,
  variant = "inline",
  homeHref = "/",
  homeLabel = "Back to projects",
}: RouteErrorProps) {
  const reference = useReferenceId(error);
  const online = useSyncExternalStore(
    subscribeOnline,
    () => navigator.onLine,
    () => true,
  );
  const [copied, setCopied] = useState(false);
  const [retrying, setRetrying] = useState(false);

  useEffect(() => {
    console.error(`[CivPMS error ${reference}]`, error);
  }, [error, reference]);

  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 2000);
    return () => window.clearTimeout(timer);
  }, [copied]);

  const panel = (
    <StatusPanel
      tone="danger"
      headingLevel={variant === "page" ? "h1" : "h2"}
      icon={online ? <ServerCrash /> : <WifiOff />}
      title={online ? "Something went wrong" : "You're offline"}
      description={
        online
          ? "We couldn't load this page. Try again in a moment. If it keeps happening, share the reference below with support."
          : "Check your internet connection, then try again. Nothing you saved is lost."
      }
      actions={
        <>
          <Button variant="outline" asChild>
            <Link href={homeHref}>{homeLabel}</Link>
          </Button>
          <Button
            loading={retrying}
            onClick={() => {
              setRetrying(true);
              retry();
              window.setTimeout(() => setRetrying(false), 1500);
            }}
          >
            <RotateCw aria-hidden />
            Try again
          </Button>
        </>
      }
      footer={
        <span className="inline-flex items-center gap-2">
          <span>
            Reference <span className="font-mono font-medium text-foreground tabular-nums">{reference}</span>
          </span>
          <button
            type="button"
            onClick={() => {
              void navigator.clipboard?.writeText(reference).then(
                () => setCopied(true),
                () => undefined,
              );
            }}
            className="inline-flex h-7 items-center gap-1 rounded-sm px-1.5 font-medium text-primary-text transition-colors hover:bg-surface-sunken focus-ring"
          >
            {copied ? <Check aria-hidden className="size-3.5" /> : <Copy aria-hidden className="size-3.5" />}
            {copied ? "Copied" : "Copy"}
          </button>
          <span role="status" className="sr-only">
            {copied ? "Reference copied" : ""}
          </span>
        </span>
      }
    />
  );

  if (variant === "page") return <StatusPage>{panel}</StatusPage>;
  return <div className="flex min-h-[60dvh] items-center justify-center py-12">{panel}</div>;
}
