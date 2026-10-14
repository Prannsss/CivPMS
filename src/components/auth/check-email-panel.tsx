"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Clock, Inbox, MailCheck, RotateCw, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FormError } from "@/components/ui/form";
import { toast } from "@/components/ui/toaster";
import { LOGIN_PATH } from "@/lib/auth-routes";
import { requestPasswordReset, resendConfirmation } from "@/server/actions/auth";
import { AuthHeading, AuthIcon } from "./auth-frame";
import { authPagePath, FORGOT_PASSWORD_PATH, RESEND_COOLDOWN_SECONDS, SIGNUP_PATH } from "./auth-flow";

export type CheckEmailPanelProps = {
  /** The address we sent to (null when the page was opened without one). */
  email: string | null;
  type: "signup" | "recovery";
  next: string | null;
};

function formatCountdown(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

/** "Check your email" after sign-up or a reset request: the address, tips, resend with cooldown. */
export function CheckEmailPanel({ email, type, next }: CheckEmailPanelProps) {
  const [cooldown, setCooldown] = useState(RESEND_COOLDOWN_SECONDS);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = window.setTimeout(() => setCooldown((value) => value - 1), 1000);
    return () => window.clearTimeout(timer);
  }, [cooldown]);

  async function resend() {
    if (!email) return;
    setSending(true);
    setError(null);
    const result =
      type === "signup" ? await resendConfirmation({ email, next }) : await requestPasswordReset({ email });
    setSending(false);
    if (!result.ok) {
      setError(result.error.message);
      return;
    }
    setCooldown(RESEND_COOLDOWN_SECONDS);
    toast.success("Email sent again", { description: `Check ${email}.` });
  }

  const backHref =
    type === "signup"
      ? authPagePath(SIGNUP_PATH, { email, next })
      : authPagePath(FORGOT_PASSWORD_PATH, { email, next });

  return (
    <div className="flex flex-col gap-8">
      <AuthHeading
        eyebrow={
          <AuthIcon>
            <MailCheck />
          </AuthIcon>
        }
        title="Check your email"
        description={
          email ? (
            <>
              We sent a link to <strong className="font-semibold break-all text-foreground">{email}</strong>.{" "}
              {type === "signup"
                ? "Open it to confirm your address and set up your account."
                : "Open it to choose a new password."}
            </>
          ) : type === "signup" ? (
            "We sent you a link. Open it to confirm your address and set up your account."
          ) : (
            "We sent you a link. Open it to choose a new password."
          )
        }
      />

      <ul className="flex flex-col gap-3 rounded-lg border border-border bg-surface-muted p-4 text-sm text-muted-foreground sm:p-5">
        <li className="flex items-start gap-3">
          <Inbox aria-hidden className="mt-0.5 size-4 shrink-0 text-foreground" />
          <span>Can&apos;t find it? Look in Spam or Promotions. It can take a minute to arrive.</span>
        </li>
        <li className="flex items-start gap-3">
          <Clock aria-hidden className="mt-0.5 size-4 shrink-0 text-foreground" />
          <span>The link works once and expires in 1 hour.</span>
        </li>
        {type === "signup" ? (
          <li className="flex items-start gap-3">
            <ShieldCheck aria-hidden className="mt-0.5 size-4 shrink-0 text-foreground" />
            <span>
              Already have an account with this email? No email is sent then.{" "}
              <Link
                href={authPagePath(LOGIN_PATH, { email, next })}
                className="rounded-xs font-medium text-primary-text underline-offset-4 hover:underline focus-ring"
              >
                Log in instead
              </Link>
              .
            </span>
          </li>
        ) : null}
      </ul>

      <div className="flex flex-col gap-3">
        {error ? <FormError>{error}</FormError> : null}
        {email ? (
          <Button
            variant="outline"
            size="lg"
            className="w-full"
            onClick={resend}
            disabled={cooldown > 0}
            loading={sending}
            loadingText="Sending…"
            data-testid="resend-email"
          >
            <RotateCw aria-hidden />
            {cooldown > 0 ? (
              <span>
                Resend email in <span className="tabular-nums">{formatCountdown(cooldown)}</span>
              </span>
            ) : (
              "Resend email"
            )}
          </Button>
        ) : null}
        <p className="text-center text-sm text-muted-foreground">
          Wrong email?{" "}
          <Link
            href={backHref}
            className="rounded-xs font-semibold text-primary-text underline-offset-4 hover:underline focus-ring"
          >
            Go back and change it
          </Link>
        </p>
      </div>

      <Button variant="ghost" className="self-center" asChild>
        <Link href={authPagePath(LOGIN_PATH, { next })}>
          <ArrowLeft aria-hidden />
          Back to log in
        </Link>
      </Button>
    </div>
  );
}
