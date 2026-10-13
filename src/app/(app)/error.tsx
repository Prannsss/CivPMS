"use client";

import { RouteError } from "@/components/app-shell/route-error";

/** The app frame itself failed to load (no shell around this boundary). */
export default function AppError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return <RouteError error={error} retry={retry} variant="page" />;
}
