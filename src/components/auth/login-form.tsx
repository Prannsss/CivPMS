"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Mail, MailCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { FormError } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/password-input";
import { toast } from "@/components/ui/toaster";
import { signInSchema, type SignInInput, type SignInValues } from "@/lib/domain/schemas";
import { resendConfirmation, signInWithPassword } from "@/server/actions/auth";
import { AuthDivider } from "./auth-frame";
import { authPagePath, checkEmailPath, FORGOT_PASSWORD_PATH, SIGNUP_PATH } from "./auth-flow";
import { applyActionError } from "./form-errors";
import { GoogleButton } from "./google-button";

export type LoginFormProps = {
  /** Safe `next` path (already cleaned by the page). */
  next: string | null;
  initialEmail?: string;
  /** Message for `/login?error=…` (expired link, Google problems, …). */
  notice?: { message: string; tone: "danger" | "info" } | null;
  googleEnabled: boolean | null;
};

/** Mockup 4: email + password, "Forgot password?", Log in, Google, link to sign up. */
export function LoginForm({ next, initialEmail = "", notice = null, googleEnabled }: LoginFormProps) {
  const router = useRouter();
  const [navigating, setNavigating] = useState(false);
  const [resending, setResending] = useState(false);
  const form = useForm<SignInInput, unknown, SignInValues>({
    resolver: zodResolver(signInSchema),
    mode: "onTouched",
    // No defaultValues on purpose: registered inputs are uncontrolled, so react-hook-form reads
    // whatever is already in them when it registers them (text typed before hydration survives).
  });
  const { errors } = form.formState;
  const rootError = form.formState.errors.root?.serverError;
  const unconfirmed = rootError?.type === "EMAIL_NOT_CONFIRMED";
  const email = useWatch({ control: form.control, name: "email" }) ?? initialEmail;

  async function onSubmit(values: SignInValues) {
    const result = await signInWithPassword({ ...values, next });
    if (!result.ok) {
      applyActionError(form, result.error, ["email", "password"]);
      if (result.error.code === "INVALID_CREDENTIALS") form.setFocus("password");
      return;
    }
    setNavigating(true);
    router.replace(result.data.redirectTo);
    router.refresh();
  }

  async function resend() {
    const address = (form.getValues("email") ?? "").trim().toLowerCase();
    setResending(true);
    const result = await resendConfirmation({ email: address, next });
    setResending(false);
    if (!result.ok) {
      toast.error("Couldn't send the email", {
        description: result.error.message,
      });
      return;
    }
    toast.success("Confirmation email sent", {
      description: `Check ${address}.`,
    });
    router.push(checkEmailPath({ email: address, type: "signup", next }));
  }

  const busy = form.formState.isSubmitting || navigating;

  return (
    <div className="flex flex-col gap-6">
      <form onSubmit={form.handleSubmit(onSubmit)} noValidate className="flex flex-col gap-5" aria-label="Log in">
        {rootError?.message ? (
          <FormError>
            <p>{rootError.message}</p>
            {unconfirmed ? (
              <Button
                variant="link"
                className="mt-1 text-[13px] font-semibold"
                onClick={resend}
                loading={resending}
                loadingText="Sending…"
              >
                <MailCheck aria-hidden />
                Resend confirmation email
              </Button>
            ) : null}
          </FormError>
        ) : notice ? (
          notice.tone === "danger" ? (
            <FormError>{notice.message}</FormError>
          ) : (
            <p
              role="status"
              className="rounded-md border border-primary/25 bg-primary-soft px-3.5 py-3 text-sm text-foreground"
            >
              {notice.message}
            </p>
          )
        ) : null}

        <Field label="Email" required error={errors.email?.message}>
          <Input
            {...form.register("email")}
            defaultValue={initialEmail}
            type="email"
            inputMode="email"
            autoComplete="email"
            autoCapitalize="none"
            spellCheck={false}
            placeholder="you@company.com"
            leading={<Mail />}
            autoFocus={!initialEmail}
          />
        </Field>
        <Field
          label="Password"
          required
          error={errors.password?.message}
          labelAside={
            <Link
              href={authPagePath(FORGOT_PASSWORD_PATH, {
                email: email?.includes("@") ? email.trim() : null,
                next,
              })}
              className="rounded-xs text-[13px] leading-5 font-medium text-primary-text underline-offset-4 hover:underline focus-ring"
            >
              Forgot password?
            </Link>
          }
        >
          <PasswordInput
            {...form.register("password")}
            autoComplete="current-password"
            autoFocus={Boolean(initialEmail)}
          />
        </Field>
        <Button type="submit" size="lg" className="mt-1 w-full" loading={busy} loadingText="Logging in…">
          Log in
        </Button>
      </form>

      <AuthDivider />
      <GoogleButton enabled={googleEnabled} next={next} />

      <p className="text-center text-sm text-muted-foreground">
        New to CivPMS?{" "}
        <Link
          href={authPagePath(SIGNUP_PATH, { next })}
          className="rounded-xs font-semibold text-primary-text underline-offset-4 hover:underline focus-ring"
        >
          Create an account
        </Link>
      </p>
    </div>
  );
}
