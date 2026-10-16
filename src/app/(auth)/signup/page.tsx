import type { Metadata } from "next";
import { AuthHeading } from "@/components/auth/auth-frame";
import { cleanNext, emailParam, firstParam } from "@/components/auth/auth-flow";
import { SignUpForm } from "@/components/auth/signup-form";
import { APP_TAGLINE } from "@/lib/constants";
import { getAuthProviders } from "@/server/auth-settings";

export const metadata: Metadata = { title: "Sign up" };

export default async function SignUpPage({ searchParams }: PageProps<"/signup">) {
  const params = await searchParams;
  const providers = await getAuthProviders();

  return (
    <div className="flex flex-col gap-8">
      <AuthHeading title="Sign up" description={APP_TAGLINE} />
      {providers?.signupDisabled ? (
        <p role="status" className="rounded-md border border-warning/40 bg-warning-soft px-3.5 py-3 text-sm text-warning-text">
          New accounts are turned off right now. If you were invited, ask your Project Manager to check with the
          administrator.
        </p>
      ) : null}
      <SignUpForm
        next={cleanNext(firstParam(params.next))}
        initialEmail={emailParam(params.email)}
        googleEnabled={providers ? providers.google : null}
      />
    </div>
  );
}
