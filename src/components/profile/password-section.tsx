"use client";

import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { ExternalLink, KeyRound } from "lucide-react";
import { PasswordStrengthMeter } from "@/components/auth/password-strength-meter";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { FormError } from "@/components/ui/form";
import { PasswordInput } from "@/components/ui/password-input";
import { toast } from "@/components/ui/toaster";
import { PASSWORD_MIN_LENGTH } from "@/lib/constants";
import { createClient } from "@/lib/supabase/client";
import { SettingsCard } from "./settings-layout";

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, "Enter your current password."),
    newPassword: z
      .string()
      .min(1, "Enter a new password.")
      .min(PASSWORD_MIN_LENGTH, `Use at least ${PASSWORD_MIN_LENGTH} characters.`)
      .max(72, "Use 72 characters or fewer."),
    confirmPassword: z.string().min(1, "Type the new password again."),
  })
  .superRefine((value, ctx) => {
    if (value.confirmPassword && value.newPassword !== value.confirmPassword) {
      ctx.addIssue({ code: "custom", path: ["confirmPassword"], message: "The passwords don't match. Type the new password again." });
    }
    if (value.newPassword && value.newPassword === value.currentPassword) {
      ctx.addIssue({ code: "custom", path: ["newPassword"], message: "Choose a password that is different from your current one." });
    }
  });
type ChangePasswordValues = z.infer<typeof changePasswordSchema>;

/** Plain-language text for Supabase Auth errors on password change. */
export function passwordErrorMessage(code: string | undefined, message: string | undefined): { field?: "newPassword"; text: string } {
  switch (code) {
    case "same_password":
      return { field: "newPassword", text: "Choose a password that is different from your current one." };
    case "weak_password":
      return { field: "newPassword", text: "This password is too easy to guess or has appeared in a data leak. Choose another one." };
    case "reauthentication_needed":
    case "session_expired":
    case "session_not_found":
      return { text: "For your security, sign out and sign in again, then change your password." };
    case "over_request_rate_limit":
    case "over_email_send_rate_limit":
      return { text: "Too many attempts. Wait a minute and try again." };
    default:
      if (message && /fetch|network/i.test(message)) return { text: "We couldn't reach CivPMS. Check your connection and try again." };
      return { text: "Your password couldn't be changed. Try again in a moment." };
  }
}

/**
 * Change password in the browser with the signed-in Supabase client (the password never goes
 * through a Server Action). The current password is checked first by signing in with it.
 */
function ChangePasswordForm({ email }: { email: string }) {
  const form = useForm<ChangePasswordValues>({ resolver: zodResolver(changePasswordSchema), mode: "onTouched" });
  const { errors, isSubmitting } = form.formState;
  const newPassword = useWatch({ control: form.control, name: "newPassword" }) ?? "";

  async function onSubmit(values: ChangePasswordValues) {
    const supabase = createClient();
    const check = await supabase.auth.signInWithPassword({ email, password: values.currentPassword });
    if (check.error) {
      if (check.error.code === "invalid_credentials") {
        form.setError("currentPassword", { type: "server", message: "That's not your current password. Check it and try again." }, { shouldFocus: true });
      } else {
        form.setError("root.serverError", { type: "server", message: passwordErrorMessage(check.error.code, check.error.message).text });
      }
      return;
    }
    const { error } = await supabase.auth.updateUser({ password: values.newPassword });
    if (error) {
      const mapped = passwordErrorMessage(error.code, error.message);
      if (mapped.field) form.setError(mapped.field, { type: "server", message: mapped.text }, { shouldFocus: true });
      else form.setError("root.serverError", { type: "server", message: mapped.text });
      return;
    }
    form.reset({ currentPassword: "", newPassword: "", confirmPassword: "" });
    toast.success("Password changed", { description: "Use your new password the next time you sign in." });
  }

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} noValidate aria-label="Change password" className="flex flex-col gap-5">
      <input type="email" name="username" autoComplete="username" value={email} readOnly hidden />
      <FormError>{errors.root?.serverError?.message}</FormError>
      <Field label="Current password" required error={errors.currentPassword?.message}>
        <PasswordInput {...form.register("currentPassword")} autoComplete="current-password" />
      </Field>
      <div className="grid gap-5 md:grid-cols-2">
        <Field label="New password" required hint={<PasswordStrengthMeter password={newPassword} />} error={errors.newPassword?.message}>
          <PasswordInput {...form.register("newPassword")} autoComplete="new-password" />
        </Field>
        <Field label="Confirm new password" required error={errors.confirmPassword?.message}>
          <PasswordInput {...form.register("confirmPassword")} autoComplete="new-password" />
        </Field>
      </div>
      <div className="flex justify-end">
        <Button type="submit" loading={isSubmitting} loadingText="Changing…">
          <KeyRound aria-hidden />
          Change password
        </Button>
      </div>
    </form>
  );
}

export function PasswordSection({ email, hasPassword }: { email: string; hasPassword: boolean }) {
  return (
    <SettingsCard
      id="password"
      title="Password"
      description={
        hasPassword
          ? `At least ${PASSWORD_MIN_LENGTH} characters. A short phrase you can remember works well.`
          : "You sign in with Google, so there is no CivPMS password to change."
      }
    >
      {hasPassword ? (
        <ChangePasswordForm email={email} />
      ) : (
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm leading-6 text-muted-foreground">Manage your password and 2-step verification in your Google account.</p>
          <Button variant="outline" asChild className="shrink-0">
            <a href="https://myaccount.google.com/security" target="_blank" rel="noreferrer noopener">
              Google security settings
              <ExternalLink aria-hidden />
            </a>
          </Button>
        </div>
      )}
    </SettingsCard>
  );
}
