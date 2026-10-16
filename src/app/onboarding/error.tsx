"use client";

import { AuthRouteError } from "@/components/auth/auth-route-error";

export default function OnboardingError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return <AuthRouteError error={error} retry={retry} homeHref="/onboarding" homeLabel="Start again" />;
}
