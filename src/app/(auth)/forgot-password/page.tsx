import type { Metadata } from "next";
import { KeyRound } from "lucide-react";
import { AuthHeading, AuthIcon } from "@/components/auth/auth-frame";
import { cleanNext, emailParam, firstParam } from "@/components/auth/auth-flow";
import { ForgotPasswordForm } from "@/components/auth/forgot-password-form";

export const metadata: Metadata = { title: "Forgot password" };

export default async function ForgotPasswordPage({ searchParams }: PageProps<"/forgot-password">) {
  const params = await searchParams;
  return (
    <div className="flex flex-col gap-8">
      <AuthHeading
        eyebrow={
          <AuthIcon>
            <KeyRound />
          </AuthIcon>
        }
        title="Forgot your password?"
        description="Enter the email you use for CivPMS and we'll send you a link to choose a new one."
      />
      <ForgotPasswordForm initialEmail={emailParam(params.email)} next={cleanNext(firstParam(params.next))} />
    </div>
  );
}
