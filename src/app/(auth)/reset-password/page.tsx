import type { Metadata } from "next";
import Link from "next/link";
import { LockKeyhole, TimerOff } from "lucide-react";
import { AuthHeading, AuthIcon } from "@/components/auth/auth-frame";
import { FORGOT_PASSWORD_PATH } from "@/components/auth/auth-flow";
import { ResetPasswordForm } from "@/components/auth/reset-password-form";
import { Button } from "@/components/ui/button";
import { LOGIN_PATH } from "@/lib/auth-routes";
import { getSessionContext } from "@/server/context";

export const metadata: Metadata = { title: "Set a new password" };

/**
 * Reached from the reset email (/auth/confirm?type=recovery or /auth/callback → here) with a
 * short recovery session. Without a session the link expired or was already used.
 */
export default async function ResetPasswordPage() {
  const { user } = await getSessionContext();

  if (!user) {
    return (
      <div className="flex flex-col gap-8">
        <AuthHeading
          eyebrow={
            <AuthIcon tone="warning">
              <TimerOff />
            </AuthIcon>
          }
          title="This reset link has expired"
          description="Reset links work once and only for an hour. Request a new one and use the newest email."
        />
        <div className="flex flex-col gap-3">
          <Button size="lg" className="w-full" asChild>
            <Link href={FORGOT_PASSWORD_PATH}>Request a new link</Link>
          </Button>
          <Button variant="ghost" className="self-center" asChild>
            <Link href={LOGIN_PATH}>Back to log in</Link>
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-8">
      <AuthHeading
        eyebrow={
          <AuthIcon>
            <LockKeyhole />
          </AuthIcon>
        }
        title="Set a new password"
        description={
          user.email ? (
            <>
              For <strong className="font-semibold break-all text-foreground">{user.email}</strong>. Use at least 10
              characters.
            </>
          ) : (
            "Use at least 10 characters."
          )
        }
      />
      <ResetPasswordForm email={user.email} />
    </div>
  );
}
