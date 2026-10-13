"use client";

import { RouteError } from "@/components/app-shell/route-error";
import { LOGIN_PATH } from "@/lib/auth-routes";

/** Error boundary body for the auth, onboarding and invitation screens (inside the split frame). */
export function AuthRouteError({
  error,
  retry,
  homeHref = LOGIN_PATH,
  homeLabel = "Back to log in",
}: {
  error: Error & { digest?: string };
  retry: () => void;
  homeHref?: string;
  homeLabel?: string;
}) {
  return <RouteError error={error} retry={retry} variant="inline" homeHref={homeHref} homeLabel={homeLabel} />;
}
