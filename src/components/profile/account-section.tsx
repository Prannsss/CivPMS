"use client";

import Link from "next/link";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Building2, Crown, HardHat, Lock, UserRound } from "lucide-react";
import { applyActionError } from "@/components/auth/form-errors";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { FormError } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { toast } from "@/components/ui/toaster";
import type { CompanyRole } from "@/lib/domain";
import { companyRoleLabel } from "@/lib/domain/permissions";
import { updateFullName } from "@/server/actions/profile";
import { AvatarEditor } from "./avatar-editor";
import { SettingsCard } from "./settings-layout";

const nameFormSchema = z.object({
  fullName: z
    .string()
    .transform((value) => value.replace(/\s+/g, " ").trim())
    .pipe(
      z
        .string()
        .min(1, "Enter your full name.")
        .min(2, "Enter your full name (at least 2 characters).")
        .max(100, "Names can be up to 100 characters. Shorten it a little."),
    ),
});
type NameFormInput = z.input<typeof nameFormSchema>;
type NameFormValues = z.output<typeof nameFormSchema>;

const ROLE_ICON: Record<CompanyRole, React.ReactNode> = {
  owner_pm: <Crown />,
  pm: <UserRound />,
  inspector: <HardHat />,
};

function NameForm({ initialName }: { initialName: string }) {
  const form = useForm<NameFormInput, unknown, NameFormValues>({
    resolver: zodResolver(nameFormSchema),
    mode: "onTouched",
    defaultValues: { fullName: initialName },
  });
  const { errors, isSubmitting, isDirty } = form.formState;

  async function onSubmit(values: NameFormValues) {
    const result = await updateFullName(values);
    if (!result.ok) {
      applyActionError(form, result.error, ["fullName"]);
      return;
    }
    form.reset({ fullName: result.data.fullName });
    toast.success("Name updated", {
      description:
        "Teammates see the new name everywhere, including the audit trail.",
    });
  }

  return (
    <form
      onSubmit={form.handleSubmit(onSubmit)}
      noValidate
      aria-label="Your name"
      className="flex flex-col gap-3"
    >
      <FormError>{errors.root?.serverError?.message}</FormError>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
        <Field
          className="min-w-0 flex-1"
          label="Full name"
          required
          hint="Shown to your teammates, on invitations and in the audit trail."
          error={errors.fullName?.message}
        >
          <Input
            {...form.register("fullName")}
            autoComplete="name"
            maxLength={120}
          />
        </Field>
        <Button
          type="submit"
          variant={isDirty ? "primary" : "outline"}
          className="self-end sm:mt-7 sm:self-start"
          loading={isSubmitting}
          loadingText="Saving…"
          disabled={!isDirty && !isSubmitting}
        >
          Save name
        </Button>
      </div>
    </form>
  );
}

/** Photo, name, sign-in email (read-only) and company role. */
export function AccountSection({
  userId,
  fullName,
  email,
  avatarUrl,
  hasGoogle,
  company,
  rolePref,
}: {
  userId: string;
  fullName: string;
  email: string;
  avatarUrl: string | null;
  hasGoogle: boolean;
  company: { name: string; role: CompanyRole } | null;
  rolePref: string | null;
}) {
  return (
    <SettingsCard
      id="account"
      title="Account"
      description="How you appear to your company and teammates."
    >
      <div className="flex flex-col gap-6">
        <AvatarEditor userId={userId} name={fullName} initialUrl={avatarUrl} />
        <Separator />
        <NameForm initialName={fullName} />
        <Separator />
        <Field
          label="Email"
          hint={
            hasGoogle
              ? "Managed by Google. You sign in with your Google account, so the address can't be changed here."
              : "You sign in with this address. It can't be changed yet."
          }
        >
          <Input
            value={email}
            readOnly
            aria-readonly
            trailing={
              <span aria-hidden className="grid size-9 place-items-center">
                <Lock className="size-4" />
              </span>
            }
            className="text-muted-foreground"
          />
        </Field>
        <Separator />
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-6">
          <div className="flex min-w-0 flex-col gap-0.5">
            <span className="text-sm leading-6 font-medium text-foreground">
              Company and role
            </span>
            <span className="text-[13px] leading-5 text-muted-foreground">
              {company
                ? company.role === "owner_pm"
                  ? "You created this company and manage its settings."
                  : "Your Owner PM manages company roles."
                : "You're not in a company yet. Enter an invite code or accept an invitation to join one."}
            </span>
          </div>
          {company ? (
            <div className="flex min-w-0 flex-wrap items-center gap-2 sm:justify-end">
              <span className="inline-flex min-w-0 items-center gap-1.5 text-sm font-medium text-foreground">
                <Building2
                  aria-hidden
                  className="size-4 shrink-0 text-muted-foreground"
                />
                <span className="truncate">{company.name}</span>
              </span>
              <Badge
                tone={
                  company.role === "owner_pm"
                    ? "primary"
                    : company.role === "pm"
                      ? "info"
                      : "neutral"
                }
                icon={ROLE_ICON[company.role]}
              >
                {companyRoleLabel(company.role)}
              </Badge>
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              {rolePref ? (
                <Badge
                  tone="neutral"
                  icon={rolePref === "pm" ? <UserRound /> : <HardHat />}
                >
                  {rolePref === "pm"
                    ? "Project Manager"
                    : "Inspector / QA / QC"}
                </Badge>
              ) : null}
              <Button
                variant="outline"
                size="sm"
                asChild
                className="max-sm:h-11"
              >
                <Link href="/">Join a company</Link>
              </Button>
            </div>
          )}
        </div>
      </div>
    </SettingsCard>
  );
}
