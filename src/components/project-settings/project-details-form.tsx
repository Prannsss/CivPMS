"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm, useWatch } from "react-hook-form";
import { Clock, RefreshCw, Save, Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ColorSwatchPicker } from "@/components/ui/color-swatch-picker";
import { CurrencyInput } from "@/components/ui/currency-input";
import { DateInput } from "@/components/ui/date-input";
import { Form, FormError, FormField } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { ChoiceCard, RadioGroup } from "@/components/ui/radio-group";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toaster";
import { formatPeso } from "@/lib/domain/format";
import { parseNumericInput } from "@/lib/domain/money";
import { loadProjectDetails, updateProjectDetails } from "@/server/actions/project-settings";
import {
  detailsFormSchema,
  fromFormValues,
  toFormDefaults,
  type DetailsFormInput,
  type DetailsFormValues,
  type ProjectDetailsValues,
} from "./details-schema";

type Conflict = { values: DetailsFormValues } | null;

/** Server field names → form field names (the threshold is edited as a percentage). */
function formFieldName(name: string): keyof DetailsFormInput | null {
  if (name === "nearBudgetThreshold") return "thresholdPercent";
  const known: (keyof DetailsFormInput)[] = [
    "name",
    "startDate",
    "endDate",
    "budget",
    "siteName",
    "siteAddress",
    "description",
    "color",
    "weighting",
  ];
  return (known as string[]).includes(name) ? (name as keyof DetailsFormInput) : null;
}

/**
 * Project details (spec §5.1, §6.5, §5.3) with optimistic concurrency (CLAUDE.md rule 6): when
 * someone else saved first, the form keeps the user's input and offers "Reload" or "Keep mine".
 */
export function ProjectDetailsForm({
  projectId,
  initial,
  initialVersion,
}: {
  projectId: string;
  initial: ProjectDetailsValues;
  initialVersion: number;
}) {
  const router = useRouter();
  const [version, setVersion] = useState(initialVersion);
  const [conflict, setConflict] = useState<Conflict>(null);
  const [resolving, setResolving] = useState<"reload" | "keep" | null>(null);

  const form = useForm<DetailsFormInput, unknown, DetailsFormValues>({
    resolver: zodResolver(detailsFormSchema),
    mode: "onTouched",
    defaultValues: toFormDefaults(initial),
  });
  const { isDirty, isSubmitting } = form.formState;
  const [budget, thresholdPercent] = useWatch({ control: form.control, name: ["budget", "thresholdPercent"] });
  const thresholdNumber = parseNumericInput(thresholdPercent);
  const budgetNumber = parseNumericInput(budget);

  async function save(values: DetailsFormValues, expectedVersion: number) {
    const result = await updateProjectDetails({ projectId, expectedVersion, values: { ...fromFormValues(values) } });
    if (!result.ok) {
      if (result.error.code === "STALE_VERSION") {
        setConflict({ values });
        return;
      }
      const fieldErrors = result.error.fieldErrors ?? {};
      let mapped = false;
      for (const [key, message] of Object.entries(fieldErrors)) {
        const field = formFieldName(key);
        if (field) {
          form.setError(field, { message }, { shouldFocus: !mapped });
          mapped = true;
        }
      }
      if (!mapped) form.setError("root.serverError", { message: result.error.message });
      return;
    }
    setConflict(null);
    setVersion(result.data.version);
    form.reset(toFormDefaults(result.data.values));
    toast.success("Project details saved");
    router.refresh();
  }

  async function reload() {
    setResolving("reload");
    const result = await loadProjectDetails({ projectId });
    setResolving(null);
    if (!result.ok) {
      toast.error("Couldn't reload the project", { description: result.error.message });
      return;
    }
    setConflict(null);
    setVersion(result.data.version);
    form.reset(toFormDefaults(result.data.values));
    toast.info("Showing the latest saved details");
    router.refresh();
  }

  async function keepMine() {
    if (!conflict) return;
    setResolving("keep");
    const latest = await loadProjectDetails({ projectId });
    if (!latest.ok) {
      setResolving(null);
      toast.error("Couldn't save your changes", { description: latest.error.message });
      return;
    }
    await save(conflict.values, latest.data.version);
    setResolving(null);
  }

  return (
    <Form {...form}>
      <form
        onSubmit={form.handleSubmit((values) => save(values, version))}
        noValidate
        className="flex flex-col gap-6"
        aria-label="Project details"
      >
        {conflict ? (
          <div
            role="alert"
            className="flex flex-col gap-3 rounded-md border border-warning/60 bg-warning-soft p-4 sm:flex-row sm:items-center"
          >
            <RefreshCw aria-hidden className="size-5 shrink-0 text-warning-text" />
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
              <p className="text-sm font-semibold text-warning-text">Changed by someone else just now</p>
              <p className="text-[13px] leading-5 text-foreground">
                Reload to see their version (your edits here are discarded), or keep yours and save over theirs.
              </p>
            </div>
            <div className="flex shrink-0 flex-col gap-2 sm:flex-row">
              <Button variant="outline" size="sm" onClick={reload} loading={resolving === "reload"} disabled={resolving !== null}>
                Reload
              </Button>
              <Button variant="outline" size="sm" onClick={keepMine} loading={resolving === "keep"} disabled={resolving !== null}>
                Keep mine
              </Button>
            </div>
          </div>
        ) : null}
        <FormError>{form.formState.errors.root?.serverError?.message}</FormError>

        <FormField
          control={form.control}
          name="name"
          label="Project name"
          required
          hint="3–120 characters, unique within your company."
          render={({ field }) => <Input {...field} value={field.value ?? ""} autoComplete="off" />}
        />

        <div className="grid gap-5 sm:grid-cols-2">
          <FormField
            control={form.control}
            name="startDate"
            label="Estimated start date"
            required
            render={({ field }) => (
              <DateInput value={field.value ?? ""} onValueChange={field.onChange} onBlur={field.onBlur} name={field.name} ref={field.ref} />
            )}
          />
          <FormField
            control={form.control}
            name="endDate"
            label="Estimated end date"
            required
            hint="Moving it into the future clears the Delayed badge."
            render={({ field }) => (
              <DateInput value={field.value ?? ""} onValueChange={field.onChange} onBlur={field.onBlur} name={field.name} ref={field.ref} />
            )}
          />
        </div>

        <FormField
          control={form.control}
          name="budget"
          label="Estimated project budget"
          required
          hint="Work package costs are compared against this amount."
          render={({ field }) => (
            <CurrencyInput
              value={typeof field.value === "number" ? field.value : parseNumericInput(field.value)}
              onValueChange={field.onChange}
              onBlur={field.onBlur}
              name={field.name}
              ref={field.ref}
              inputMode="decimal"
            />
          )}
        />

        <div className="grid gap-5 sm:grid-cols-2">
          <FormField
            control={form.control}
            name="siteName"
            label="Site name or location"
            hint="Shown on the project card and to everyone on the project."
            render={({ field }) => <Input {...field} value={field.value ?? ""} placeholder="e.g. Talisay, Cebu" />}
          />
          <FormField
            control={form.control}
            name="siteAddress"
            label="Site address"
            render={({ field }) => <Input {...field} value={field.value ?? ""} placeholder="Street, barangay, city" />}
          />
        </div>

        <FormField
          control={form.control}
          name="description"
          label="Description"
          render={({ field }) => (
            <Textarea {...field} value={field.value ?? ""} rows={3} placeholder="Scope, client, contract number…" />
          )}
        />

        <FormField
          control={form.control}
          name="color"
          label="Card color"
          hint="Used for the project card on the home screen."
          render={({ field }) => <ColorSwatchPicker value={field.value} onValueChange={field.onChange} />}
        />

        <fieldset className="flex flex-col gap-3">
          <legend className="mb-1 text-label text-foreground">Progress weighting</legend>
          <p className="-mt-1 text-xs leading-4 text-muted-foreground">
            Overall % complete averages the work packages, weighted by how big each one is. Work packages without the
            chosen value fall back to the other one (or count equally).
          </p>
          <FormField
            control={form.control}
            name="weighting"
            render={({ field }) => (
              <RadioGroup
                value={field.value}
                onValueChange={field.onChange}
                aria-label="Progress weighting"
                className="grid gap-3 sm:grid-cols-2"
              >
                <ChoiceCard
                  value="cost"
                  icon={<Wallet />}
                  title="By estimated cost"
                  description="A ₱5M work package counts five times more than a ₱1M one. Best when costs are known."
                />
                <ChoiceCard
                  value="hours"
                  icon={<Clock />}
                  title="By working hours"
                  description="Longer work counts more, whatever it costs. Best for labour-driven schedules."
                />
              </RadioGroup>
            )}
          />
        </fieldset>

        <FormField
          control={form.control}
          name="thresholdPercent"
          label="Near Budget Limit warning"
          hint={
            thresholdNumber !== null && budgetNumber !== null && thresholdNumber >= 50 && thresholdNumber <= 100
              ? `Warn when work packages add up to ${thresholdNumber}% of the budget (${formatPeso((budgetNumber * thresholdNumber) / 100)}).`
              : "Between 50% and 100% of the budget. 90% is the usual setting."
          }
          className="sm:max-w-xs"
          render={({ field }) => (
            <Input
              name={field.name}
              ref={field.ref}
              onBlur={field.onBlur}
              value={field.value === undefined || field.value === null ? "" : String(field.value)}
              onChange={(event) => field.onChange(event.target.value)}
              inputMode="numeric"
              trailing={<span className="pr-2.5 text-sm text-muted-foreground">%</span>}
              className="tabular-nums"
            />
          )}
        />

        <div className="flex flex-col-reverse gap-2 border-t border-border pt-5 sm:flex-row sm:justify-end">
          <Button
            variant="outline"
            onClick={() => {
              form.reset();
              setConflict(null);
            }}
            disabled={!isDirty || isSubmitting}
          >
            Discard changes
          </Button>
          <Button type="submit" loading={isSubmitting} loadingText="Saving…" disabled={!isDirty && !conflict}>
            <Save aria-hidden />
            Save changes
          </Button>
        </div>
      </form>
    </Form>
  );
}
