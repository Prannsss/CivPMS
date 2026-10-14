import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { cleanNext, firstParam } from "@/components/auth/auth-flow";
import { OnboardingFlow } from "@/components/onboarding/onboarding-flow";
import { HOME_PATH, loginRedirectPath, ONBOARDING_PATH } from "@/lib/auth-routes";
import { getOnboardingState } from "@/server/queries/onboarding";

export const metadata: Metadata = { title: "Set up your account" };

/**
 * Onboarding (mockup 5): signed in but `profiles.onboarded_at` is empty. Already onboarded
 * visitors go to `next` (or home).
 */
export default async function OnboardingPage({ searchParams }: PageProps<"/onboarding">) {
  const params = await searchParams;
  const next = cleanNext(firstParam(params.next));
  const state = await getOnboardingState();

  if (!state) {
    const search = next ? `?${new URLSearchParams({ next }).toString()}` : "";
    redirect(loginRedirectPath(ONBOARDING_PATH, search));
  }
  if (state.onboarded) redirect(next ?? HOME_PATH);

  return (
    <OnboardingFlow
      email={state.email}
      initialName={state.fullName}
      initialRole={state.rolePref}
      profileSaved={Boolean(state.fullName && state.rolePref)}
      invitations={state.invitations}
      next={next}
    />
  );
}
