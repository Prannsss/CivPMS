"use client";

import { AuthRouteError } from "@/components/auth/auth-route-error";

export default function InviteError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return <AuthRouteError error={error} retry={retry} homeHref="/" homeLabel="Go to CivPMS" />;
}
