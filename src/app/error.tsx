"use client";

import { RouteError } from "@/components/app-shell/route-error";

/** Last-resort boundary for routes outside the app shells (auth, invitations, …). */
export default function RootError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return <RouteError error={error} retry={retry} variant="page" homeLabel="Go to CivPMS" />;
}
