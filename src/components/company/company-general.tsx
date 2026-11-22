"use client";

import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { applyActionError } from "@/components/auth/form-errors";
import { SettingsCard } from "@/components/profile/settings-layout";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { FormError } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/toaster";
import { todayInManila } from "@/lib/domain/dates";
import { formatDate } from "@/lib/domain/format";
import { companyNameSchema } from "@/lib/domain/schemas";
import { renameCompany } from "@/server/actions/company";

const renameSchema = z.object({ name: companyNameSchema });
type RenameInput = z.input<typeof renameSchema>;
type RenameValues = z.output<typeof renameSchema>;

function RenameForm({ name }: { name: string }) {
  const form = useForm<RenameInput, unknown, RenameValues>({
    resolver: zodResolver(renameSchema),
    mode: "onTouched",
    defaultValues: { name },
  });
  const { errors, isSubmitting, isDirty } = form.formState;

  async function onSubmit(values: RenameValues) {
    if (values.name === name) {
      form.reset({ name });
      return;
    }
    const result = await renameCompany(values);
    if (!result.ok) {
      applyActionError(form, result.error, ["name"]);
      return;
    }
    form.reset({ name: result.data.name });
    toast.success("Company renamed", {
      description: `Everyone in the company now sees “${result.data.name}”.`,
    });
  }

  return (
    <form
      onSubmit={form.handleSubmit(onSubmit)}
      noValidate
      aria-label="Rename company"
      className="flex flex-col gap-3"
    >
      <FormError>{errors.root?.serverError?.message}</FormError>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
        <Field
          className="min-w-0 flex-1"
          label="Company name"
          required
          hint="Shown on the projects home, invitations and emails. Must be unique on CivPMS."
          error={errors.name?.message}
        >
          <Input
            {...form.register("name")}
            autoComplete="organization"
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

function InfoRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-0.5 sm:flex-row sm:items-baseline sm:justify-between sm:gap-6">
      <dt className="text-[13px] leading-5 text-muted-foreground">{label}</dt>
      <dd className="min-w-0 text-sm leading-6 font-medium break-words text-foreground sm:text-right">
        {children}
      </dd>
    </div>
  );
}

/** Company name (Owner PM can rename) and who owns it. */
export function CompanyGeneral({
  name,
  ownerName,
  createdAt,
  canEdit,
  memberCount,
}: {
  name: string;
  ownerName: string | null;
  createdAt: string;
  canEdit: boolean;
  memberCount: number;
}) {
  return (
    <SettingsCard
      id="general"
      title="General"
      description={
        canEdit
          ? "Your company's name and owner."
          : "Only the Owner PM can change company details."
      }
    >
      <div className="flex flex-col gap-5">
        {canEdit ? <RenameForm name={name} /> : null}
        <dl className="flex flex-col gap-3 rounded-md bg-surface-muted px-4 py-3.5">
          {canEdit ? null : <InfoRow label="Company name">{name}</InfoRow>}
          <InfoRow label="Owner PM">{ownerName ?? "—"}</InfoRow>
          <InfoRow label="Members">
            <span className="tabular-nums">{memberCount}</span>
          </InfoRow>
          <InfoRow label="Created">
            <span className="tabular-nums">
              {formatDate(todayInManila(new Date(createdAt)))}
            </span>
          </InfoRow>
        </dl>
      </div>
    </SettingsCard>
  );
}
