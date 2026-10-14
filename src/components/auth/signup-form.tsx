"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Mail } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { FormError } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/password-input";
import { signUpSchema, type SignUpInput, type SignUpValues } from "@/lib/domain/schemas";
import { LOGIN_PATH } from "@/lib/auth-routes";
import { signUpWithPassword } from "@/server/actions/auth";
import { AuthDivider } from "./auth-frame";
import { authPagePath } from "./auth-flow";
import { applyActionError } from "./form-errors";
import { GoogleButton } from "./google-button";
import { PasswordStrengthMeter } from "./password-strength-meter";

export type SignUpFormProps = {
  next: string | null;
  initialEmail?: string;
  googleEnabled: boolean | null;
};

/**
 * Mockup 3 / D10: only email + password (+ Google). Name, role and company come in onboarding.
 * On success the visitor goes to /check-email to confirm the address.
 */
export function SignUpForm({ next, initialEmail = "", googleEnabled }: SignUpFormProps) {
  const router = useRouter();
  const [navigating, setNavigating] = useState(false);
  const form = useForm<SignUpInput, unknown, SignUpValues>({
    resolver: zodResolver(signUpSchema),
    mode: "onTouched",
    // Uncontrolled on purpose (no defaultValues): text typed before hydration survives.
  });
  const { errors } = form.formState;
  const password = useWatch({ control: form.control, name: "password" }) ?? "";
  const rootError = form.formState.errors.root?.serverError;

  async function onSubmit(values: SignUpValues) {
    const result = await signUpWithPassword({ ...values, next });
    if (!result.ok) {
      applyActionError(form, result.error, ["email", "password"]);
      return;
    }
    setNavigating(true);
    router.push(result.data.redirectTo);
  }

  const busy = form.formState.isSubmitting || navigating;

  return (
    <div className="flex flex-col gap-6">
      <form onSubmit={form.handleSubmit(onSubmit)} noValidate className="flex flex-col gap-5" aria-label="Sign up">
        <FormError>{rootError?.message}</FormError>
        <Field
          label="Email"
          required
          hint="Use the email your Project Manager will invite."
          error={errors.email?.message}
        >
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
          hint={<PasswordStrengthMeter password={password} />}
          error={errors.password?.message}
        >
          <PasswordInput {...form.register("password")} autoComplete="new-password" autoFocus={Boolean(initialEmail)} />
        </Field>
        <Button type="submit" size="lg" className="mt-1 w-full" loading={busy} loadingText="Creating account…">
          Create account
        </Button>
      </form>

      <AuthDivider />
      <GoogleButton enabled={googleEnabled} next={next} />

      <p className="text-center text-sm text-muted-foreground">
        Already have an account?{" "}
        <Link
          href={authPagePath(LOGIN_PATH, { next })}
          className="rounded-xs font-semibold text-primary-text underline-offset-4 hover:underline focus-ring"
        >
          Log in
        </Link>
      </p>
    </div>
  );
}
