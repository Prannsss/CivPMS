"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm, useWatch } from "react-hook-form";
import { Clock, Pencil, RefreshCw, Save, Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ColorSwatchPicker } from "@/components/ui/color-swatch-picker";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { CurrencyInput } from "@/components/ui/currency-input";
import { DateInput } from "@/components/ui/date-input";
import { Field } from "@/components/ui/field";
import { Form, FormError, FormField } from "@/components/ui/form";
import { IconButton } from "@/components/ui/icon-button";
import { Input } from "@/components/ui/input";
import { getProjectColor } from "@/components/ui/project-color";
import { ChoiceCard, RadioGroup } from "@/components/ui/radio-group";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toaster";
import { formatDate, formatPeso } from "@/lib/domain/format";
import { parseNumericInput } from "@/lib/domain/money";
import { loadProjectDetails, updateProjectDetails } from "@/server/actions/project-settings";
import { cn } from "@/lib/utils";
import { SettingsPanel } from "./settings-section";
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

const FORM_ID = "project-details-form";

/**
 * Project details (spec §5.1, §6.5, §5.3). Read-only first: the pencil in the panel header opens
 * the form and turns into Cancel + Save. Optimistic concurrency (CLAUDE.md rule 6): when someone
 * else saved first, the form keeps the user's input and offers "Reload" or "Keep mine".
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
  const confirm = useConfirm();
  const [editing, setEditing] = useState(false);
  const editButton = useRef<HTMLButtonElement>(null);
  const wasEditing = useRef(false);
  const [saved, setSaved] = useState<ProjectDetailsValues>(initial);
  const [version, setVersion] = useState(initialVersion);
  const [conflict, setConflict] = useState<Conflict>(null);
  const [resolving, setResolving] = useState<"reload" | "keep" | null>(null);

  const form = useForm<DetailsFormInput, unknown, DetailsFormValues>({
    resolver: zodResolver(detailsFormSchema),
    mode: "onTouched",
    defaultValues: toFormDefaults(initial),
  });
  const { isDirty, isSubmitting, errors } = form.formState;
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
    setSaved(result.data.values);
    form.reset(toFormDefaults(result.data.values));
    setEditing(false);
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
    setSaved(result.data.values);
    form.reset(toFormDefaults(result.data.values));
    setEditing(false);
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

  /** Leaves edit mode; asks first when there are unsaved edits. */
  async function cancel() {
    if (isDirty) {
      const discard = await confirm({
        title: "Discard your changes?",
        description: "Your edits to the project details are not saved.",
        confirmLabel: "Discard changes",
        cancelLabel: "Keep editing",
        tone: "danger",
      });
      if (!discard) return;
    }
    form.reset(toFormDefaults(saved));
    setConflict(null);
    setEditing(false);
  }

  function onFormKeyDown(event: React.KeyboardEvent<HTMLFormElement>) {
    if (event.key === "Escape" && !isSubmitting) {
      event.preventDefault();
      void cancel();
    }
  }

  // Leaving edit mode puts focus back on the pencil instead of dropping it on the page.
  useEffect(() => {
    if (wasEditing.current && !editing) editButton.current?.focus();
    wasEditing.current = editing;
  }, [editing]);

  const actions = editing ? (
    <>
      <Button variant="outline" size="sm" className="max-sm:h-11" onClick={() => void cancel()} disabled={isSubmitting}>
        Cancel
      </Button>
      <Button
        type="submit"
        form={FORM_ID}
        size="sm"
        className="max-sm:h-11"
        loading={isSubmitting}
        loadingText="Saving…"
        disabled={!isDirty && !conflict}
      >
        <Save aria-hidden />
        Save
      </Button>
    </>
  ) : (
    <IconButton ref={editButton} aria-label="Edit details" variant="ghost" size="sm" onClick={() => setEditing(true)}>
      <Pencil aria-hidden />
    </IconButton>
  );

  return (
    <SettingsPanel id="details" title="Details" actions={actions}>
      {editing ? (
        <Form {...form}>
          <form
            method="post"
            id={FORM_ID}
            onSubmit={form.handleSubmit((values) => save(values, version))}
            onKeyDown={onFormKeyDown}
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
                  <Button variant="outline" size="sm" className="max-sm:h-11" onClick={reload} loading={resolving === "reload"} disabled={resolving !== null}>
                    Reload
                  </Button>
                  <Button variant="outline" size="sm" className="max-sm:h-11" onClick={keepMine} loading={resolving === "keep"} disabled={resolving !== null}>
                    Keep mine
                  </Button>
                </div>
              </div>
            ) : null}
            <FormError>{form.formState.errors.root?.serverError?.message}</FormError>

            {/* Plain text fields use register() (uncontrolled): text typed before hydration is kept. */}
            <Field label="Project name" required hint="Must be unique in your company." error={errors.name?.message}>
              <Input {...form.register("name")} autoComplete="off" autoFocus />
            </Field>

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
              hint="Work package costs count against this."
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
              <Field
                label="Site name or location"
                error={errors.siteName?.message}
              >
                <Input {...form.register("siteName")} placeholder="e.g. Talisay, Cebu" />
              </Field>
              <Field label="Site address" error={errors.siteAddress?.message}>
                <Input {...form.register("siteAddress")} placeholder="Street, barangay, city" />
              </Field>
            </div>

            <Field label="Description" error={errors.description?.message}>
              <Textarea {...form.register("description")} rows={3} placeholder="Scope, client, contract number…" />
            </Field>

            <FormField
              control={form.control}
              name="color"
              label="Card color"
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
                      description="A ₱5M package counts 5× a ₱1M one. Best when costs are known."
                    />
                    <ChoiceCard
                      value="hours"
                      icon={<Clock />}
                      title="By working hours"
                      description="Longer work counts more. Best for labour-heavy work."
                    />
                  </RadioGroup>
                )}
              />
            </fieldset>

            <Field
              label="Near Budget Limit warning"
              error={errors.thresholdPercent?.message}
              hint={
                thresholdNumber !== null && budgetNumber !== null && thresholdNumber >= 50 && thresholdNumber <= 100
                  ? `Warn when work packages add up to ${thresholdNumber}% of the budget (${formatPeso((budgetNumber * thresholdNumber) / 100)}).`
                  : "Between 50% and 100% of the budget. 90% is the usual setting."
              }
              className="sm:max-w-xs"
            >
              <Input
                {...form.register("thresholdPercent")}
                inputMode="numeric"
                trailing={<span className="pr-2.5 text-sm text-muted-foreground">%</span>}
                className="tabular-nums"
              />
            </Field>

          </form>
        </Form>
      ) : (
        <DetailsReadView values={saved} />
      )}
    </SettingsPanel>
  );
}

const WEIGHTING_LABELS: Record<ProjectDetailsValues["weighting"], string> = {
  cost: "By estimated cost",
  hours: "By working hours",
};

/** The saved details, read-only, laid out like the form so nothing jumps when editing starts. */
function DetailsReadView({ values }: { values: ProjectDetailsValues }) {
  const color = getProjectColor(values.color);
  const percent = Math.round(values.nearBudgetThreshold * 100);
  return (
    <dl className="grid gap-x-6 gap-y-5 sm:grid-cols-2" aria-label="Project details">
      <ReadItem label="Project name" className="sm:col-span-2">
        <span className="text-base font-semibold">{values.name}</span>
      </ReadItem>
      <ReadItem label="Estimated start date">
        <span className="tabular-nums">{formatDate(values.startDate)}</span>
      </ReadItem>
      <ReadItem label="Estimated end date">
        <span className="tabular-nums">{formatDate(values.endDate)}</span>
      </ReadItem>
      <ReadItem label="Estimated project budget">
        <span className="font-semibold tabular-nums">{formatPeso(values.budget)}</span>
      </ReadItem>
      <ReadItem label="Near Budget Limit warning">
        <span className="tabular-nums">
          {percent}% <span className="text-muted-foreground">· {formatPeso((values.budget * percent) / 100)}</span>
        </span>
      </ReadItem>
      <ReadItem label="Site name or location">{values.siteName || <NotSet />}</ReadItem>
      <ReadItem label="Site address">{values.siteAddress || <NotSet />}</ReadItem>
      <ReadItem label="Description" className="sm:col-span-2">
        {values.description ? <span className="whitespace-pre-line">{values.description}</span> : <NotSet />}
      </ReadItem>
      <ReadItem label="Card color">
        <span className="inline-flex items-center gap-2">
          <span aria-hidden className={cn("size-4 rounded-full", color.solid)} />
          {color.label}
        </span>
      </ReadItem>
      <ReadItem label="Progress weighting">{WEIGHTING_LABELS[values.weighting]}</ReadItem>
    </dl>
  );
}

function ReadItem({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("flex min-w-0 flex-col gap-1", className)}>
      <dt className="text-label text-muted-foreground">{label}</dt>
      <dd className="text-sm leading-6 break-words text-foreground">{children}</dd>
    </div>
  );
}

function NotSet() {
  return <span className="text-muted-foreground">Not set</span>;
}
