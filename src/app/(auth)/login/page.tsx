import type { Metadata } from "next";
import { AuthHeading } from "@/components/auth/auth-frame";
import { cleanNext, emailParam, firstParam } from "@/components/auth/auth-flow";
import { LoginForm } from "@/components/auth/login-form";
import { APP_TAGLINE } from "@/lib/constants";
import { authRedirectError } from "@/lib/errors";
import { getAuthProviders } from "@/server/auth-settings";

export const metadata: Metadata = { title: "Log in" };

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const params = await searchParams;
  const next = cleanNext(firstParam(params.next));
  const redirectError = authRedirectError(firstParam(params.error));
  const providers = await getAuthProviders();

  return (
    <div className="flex flex-col gap-8">
      <AuthHeading title="Log in" description={APP_TAGLINE} />
      <LoginForm
        next={next}
        initialEmail={emailParam(params.email)}
        googleEnabled={providers ? providers.google : null}
        notice={
          redirectError
            ? {
                message: redirectError.message,
                tone: redirectError.code === "OAUTH_NOT_CONFIGURED" ? "info" : "danger",
              }
            : null
        }
      />
    </div>
  );
}
