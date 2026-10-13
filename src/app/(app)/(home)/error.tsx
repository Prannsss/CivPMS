"use client";

import { RouteError } from "@/components/app-shell/route-error";

export default function HomeError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return <RouteError error={error} retry={retry} />;
}
