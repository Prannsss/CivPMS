"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toaster";
import { ONBOARDING_PATH } from "@/lib/auth-routes";
import { DEFAULT_MESSAGES, toAppError } from "@/lib/errors";
import { createClient } from "@/lib/supabase/client";
import { cleanNext } from "./auth-flow";

/**
 * Google's "G" mark. Third-party brand artwork must keep Google's own colors, so this is the one
 * place in the app with literal fills instead of design tokens.
 */
function GoogleMark() {
  return (
    <svg aria-hidden viewBox="0 0 24 24" className="size-[18px]">
      <path
        fill="#4285F4"
        d="M23.52 12.27c0-.85-.08-1.67-.22-2.45H12v4.64h6.46a5.52 5.52 0 0 1-2.4 3.62v3h3.88c2.27-2.09 3.58-5.17 3.58-8.81Z"
      />
      <path
        fill="#34A853"
        d="M12 24c3.24 0 5.96-1.07 7.94-2.91l-3.88-3.01c-1.07.72-2.45 1.15-4.06 1.15-3.12 0-5.77-2.11-6.71-4.95H1.28v3.11A12 12 0 0 0 12 24Z"
      />
      <path
        fill="#FBBC05"
        d="M5.29 14.28A7.2 7.2 0 0 1 4.91 12c0-.79.14-1.56.38-2.28V6.61H1.28A12 12 0 0 0 0 12c0 1.94.46 3.77 1.28 5.39l4.01-3.11Z"
      />
      <path
        fill="#EA4335"
        d="M12 4.77c1.76 0 3.34.61 4.59 1.8l3.44-3.44C17.95 1.19 15.24 0 12 0A12 12 0 0 0 1.28 6.61l4.01 3.11C6.23 6.88 8.88 4.77 12 4.77Z"
      />
    </svg>
  );
}

export type GoogleButtonProps = {
  /**
   * Whether Google is switched on in Supabase (from `getAuthProviders()`); `null` when unknown,
   * in which case the button tries and the callback reports problems.
   */
  enabled: boolean | null;
  /** Where to land after signing in (made safe). Defaults to onboarding, which sends onboarded people home. */
  next?: string | null;
  label?: string;
};

/** "Continue with Google": starts the OAuth (PKCE) redirect; returns through /auth/callback. */
export function GoogleButton({ enabled, next, label = "Continue with Google" }: GoogleButtonProps) {
  const [pending, setPending] = useState(false);

  async function start() {
    if (enabled === false) {
      toast.info("Google sign-in isn't set up yet", {
        description: "Use your email and password for now. Your administrator can turn Google on later.",
      });
      return;
    }
    setPending(true);
    const destination = cleanNext(next) ?? ONBOARDING_PATH;
    const redirectTo = `${window.location.origin}/auth/callback?${new URLSearchParams({ next: destination }).toString()}`;
    try {
      const { error } = await createClient().auth.signInWithOAuth({ provider: "google", options: { redirectTo } });
      if (error) throw error;
      // The browser is now leaving for Google; keep the spinner until it does.
    } catch (error) {
      setPending(false);
      const appError = toAppError(error);
      if (appError.code === "OAUTH_NOT_CONFIGURED") {
        toast.info("Google sign-in isn't set up yet", { description: DEFAULT_MESSAGES.OAUTH_NOT_CONFIGURED });
      } else {
        toast.error("Couldn't start Google sign-in", { description: appError.message });
      }
    }
  }

  return (
    <Button
      variant="outline"
      size="lg"
      className="w-full"
      onClick={start}
      loading={pending}
      loadingText="Opening Google…"
      data-testid="google-sign-in"
    >
      <GoogleMark />
      {label}
    </Button>
  );
}
