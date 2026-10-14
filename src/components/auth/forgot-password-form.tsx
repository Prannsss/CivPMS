"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { ArrowLeft, Mail } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { FormError } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { LOGIN_PATH } from "@/lib/auth-routes";
import { forgotPasswordSchema, type ForgotPasswordInput, type ForgotPasswordValues } from "@/lib/domain/schemas";
import { requestPasswordReset } from "@/server/actions/auth";
import { authPagePath } from "./auth-flow";
import { applyActionError } from "./form-errors";

export function ForgotPasswordForm({ initialEmail = "", next }: { initialEmail?: string; next: string | null }) {
  const router = useRouter();
  const [navigating, setNavigating] = useState(false);
  const form = useForm<ForgotPasswordInput, unknown, ForgotPasswordValues>({
    resolver: zodResolver(forgotPasswordSchema),
    mode: "onTouched",
    // Uncontrolled on purpose (no defaultValues): text typed before hydration survives.
  });
  const rootError = form.formState.errors.root?.serverError;

  async function onSubmit(values: ForgotPasswordValues) {
    const result = await requestPasswordReset(values);
    if (!result.ok) {
      applyActionError(form, result.error, ["email"]);
      return;
    }
    setNavigating(true);
    router.push(result.data.redirectTo);
  }

  return (
    <div className="flex flex-col gap-6">
      <form
        onSubmit={form.handleSubmit(onSubmit)}
        noValidate
        className="flex flex-col gap-5"
        aria-label="Reset your password"
      >
        <FormError>{rootError?.message}</FormError>
        <Field
          label="Email"
          required
          hint="We'll email you a link to set a new password."
          error={form.formState.errors.email?.message}
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
            autoFocus
          />
        </Field>
        <Button
          type="submit"
          size="lg"
          className="mt-1 w-full"
          loading={form.formState.isSubmitting || navigating}
          loadingText="Sending link…"
        >
          Send reset link
        </Button>
      </form>
      <Button variant="ghost" className="self-center" asChild>
        <Link href={authPagePath(LOGIN_PATH, { next, email: initialEmail || null })}>
          <ArrowLeft aria-hidden />
          Back to log in
        </Link>
      </Button>
    </div>
  );
}
