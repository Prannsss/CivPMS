"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { FormError } from "@/components/ui/form";
import { PasswordInput } from "@/components/ui/password-input";
import { toast } from "@/components/ui/toaster";
import { resetPasswordSchema, type ResetPasswordInput, type ResetPasswordValues } from "@/lib/domain/schemas";
import { updatePassword } from "@/server/actions/auth";
import { applyActionError } from "./form-errors";
import { PasswordStrengthMeter } from "./password-strength-meter";

/** New password + confirmation for the signed-in (recovery) session. */
export function ResetPasswordForm({ email }: { email: string | null }) {
  const router = useRouter();
  const [navigating, setNavigating] = useState(false);
  const form = useForm<ResetPasswordInput, unknown, ResetPasswordValues>({
    resolver: zodResolver(resetPasswordSchema),
    mode: "onTouched",
    // Uncontrolled on purpose (no defaultValues): text typed before hydration survives.
  });
  const { errors } = form.formState;
  const password = useWatch({ control: form.control, name: "password" }) ?? "";
  const rootError = form.formState.errors.root?.serverError;

  async function onSubmit(values: ResetPasswordValues) {
    const result = await updatePassword(values);
    if (!result.ok) {
      applyActionError(form, result.error, ["password", "confirmPassword"]);
      return;
    }
    setNavigating(true);
    toast.success("Password updated", { description: "You're signed in with your new password." });
    router.replace(result.data.redirectTo);
    router.refresh();
  }

  return (
    <form
      onSubmit={form.handleSubmit(onSubmit)}
      noValidate
      className="flex flex-col gap-5"
      aria-label="Set a new password"
    >
      {/* Lets password managers save the new password against the right account. */}
      {email ? <input type="email" name="username" autoComplete="username" value={email} readOnly hidden /> : null}
      <FormError>{rootError?.message}</FormError>
      <Field
        label="New password"
        required
        hint={<PasswordStrengthMeter password={password} />}
        error={errors.password?.message}
      >
        <PasswordInput {...form.register("password")} autoComplete="new-password" autoFocus />
      </Field>
      <Field label="Confirm new password" required error={errors.confirmPassword?.message}>
        <PasswordInput {...form.register("confirmPassword")} autoComplete="new-password" />
      </Field>
      <Button
        type="submit"
        size="lg"
        className="mt-1 w-full"
        loading={form.formState.isSubmitting || navigating}
        loadingText="Saving…"
      >
        Update password
      </Button>
    </form>
  );
}
