"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useForm, useWatch, type Resolver } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { FolderPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ColorSwatchPicker } from "@/components/ui/color-swatch-picker";
import { CurrencyInput } from "@/components/ui/currency-input";
import { DateInput } from "@/components/ui/date-input";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Form, FormError, FormField } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { getProjectColor } from "@/components/ui/project-color";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toaster";
import type { ProjectColorKey } from "@/lib/constants";
import { diffDays, isValidISODate, todayInManila } from "@/lib/domain/dates";
import { formatDate, formatPesoCompact } from "@/lib/domain/format";
import {
  projectCreateSchema,
  type ProjectCreateInput,
  type ProjectCreateValues,
} from "@/lib/domain/schemas";
import { createProject } from "@/server/actions/projects";

const FORM_FIELDS = ["name", "startDate", "endDate", "budget", "siteName", "siteAddress", "description", "color"] as const;
type FormFieldName = (typeof FORM_FIELDS)[number];

function isFormField(value: string): value is FormFieldName {
  return (FORM_FIELDS as readonly string[]).includes(value);
}

function defaults(color: ProjectColorKey): ProjectCreateInput {
  return {
    name: "",
    startDate: todayInManila(),
    endDate: "",
    budget: null,
    siteName: "",
    siteAddress: "",
    description: "",
    color,
  };
}

const schemaResolver = zodResolver(projectCreateSchema);

/**
 * The shared schema checks date order in an object-level refinement, which zod only runs once every
 * field parses. This wrapper reports "End date must be on or after …" right away, even while other
 * fields (e.g. the budget) are still empty, so the user sees it on blur.
 */
const projectResolver: Resolver<ProjectCreateInput, unknown, ProjectCreateValues> = async (values, context, options) => {
  const result = await schemaResolver(values, context, options);
  const { startDate, endDate } = values;
  if (
    Object.keys(result.errors).length > 0 &&
    !result.errors.endDate &&
    isValidISODate(startDate) &&
    isValidISODate(endDate) &&
    endDate < startDate
  ) {
    return {
      values: {},
      errors: {
        ...result.errors,
        endDate: { type: "custom", message: `End date must be on or after ${formatDate(startDate)}.` },
      },
    };
  }
  return result;
};

function Optional() {
  return <span className="text-xs leading-4 text-muted-foreground">Optional</span>;
}

/** "Runs 274 calendar days (about 9 months)" under the end date once both dates make sense. */
function durationHint(start: unknown, end: unknown): string {
  if (!isValidISODate(start) || !isValidISODate(end) || end < start) return "On or after the start date.";
  const days = diffDays(end, start) + 1;
  const months = Math.round(days / 30.44);
  const about = months >= 2 ? ` (about ${months} months)` : "";
  return `Runs ${days} calendar ${days === 1 ? "day" : "days"}${about}.`;
}

export type CreateProjectDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Pre-selected card color (rotates through the palette). */
  suggestedColor: ProjectColorKey;
  companyName: string;
};

/**
 * Create project (spec §5.1): name, dates, budget, site, description and card color. Validates on
 * blur and on submit with the shared zod schema; server errors land on their field
 * (PROJECT_NAME_TAKEN → name). On success it opens the new project.
 */
export function CreateProjectDialog({ open, onOpenChange, suggestedColor, companyName }: CreateProjectDialogProps) {
  const [busy, setBusy] = useState(false);
  return (
    <Dialog open={open} onOpenChange={(next) => (busy ? undefined : onOpenChange(next))}>
      <DialogContent
        size="lg"
        data-testid="create-project-dialog"
        // A half-filled form shouldn't vanish on a stray click outside; Esc and Cancel still close it.
        onInteractOutside={(event) => event.preventDefault()}
      >
        {/* Mounted only while open, so every opening starts from a fresh form. */}
        <CreateProjectForm
          suggestedColor={suggestedColor}
          companyName={companyName}
          onClose={() => onOpenChange(false)}
          onBusyChange={setBusy}
        />
      </DialogContent>
    </Dialog>
  );
}

function CreateProjectForm({
  suggestedColor,
  companyName,
  onClose,
  onBusyChange,
}: {
  suggestedColor: ProjectColorKey;
  companyName: string;
  onClose: () => void;
  onBusyChange: (busy: boolean) => void;
}) {
  const router = useRouter();
  const [serverError, setServerError] = useState<string | null>(null);
  const form = useForm<ProjectCreateInput, unknown, ProjectCreateValues>({
    resolver: projectResolver,
    mode: "onTouched",
    defaultValues: defaults(suggestedColor),
  });
  const [startDate, endDate, budget, color] = useWatch({
    control: form.control,
    name: ["startDate", "endDate", "budget", "color"],
  });

  async function onSubmit(values: ProjectCreateValues) {
    setServerError(null);
    onBusyChange(true);
    const result = await createProject(values);
    onBusyChange(false);
    if (!result.ok) {
      const { fieldErrors, message } = result.error;
      let focused = false;
      for (const [field, fieldMessage] of Object.entries(fieldErrors ?? {})) {
        if (!isFormField(field)) continue;
        form.setError(field, { message: fieldMessage }, { shouldFocus: !focused });
        focused = true;
      }
      if (!focused) setServerError(message);
      return;
    }
    const href = `/projects/${result.data.id}`;
    onClose();
    toast.success("Project created", {
      description: `${result.data.name} is ready. Add its deliverables next.`,
      action: { label: "Open project", onClick: () => router.push(href) },
    });
    router.push(href);
  }

  const submitting = form.formState.isSubmitting;
  const budgetValue = typeof budget === "number" ? budget : null;

  return (
    <Form {...form}>
      <form noValidate onSubmit={form.handleSubmit(onSubmit)} className="flex min-h-0 flex-1 flex-col">
        <DialogHeader>
          <DialogTitle>New project</DialogTitle>
          <DialogDescription>
            The basics for {companyName}. Deliverables, costs and the team come next.
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="flex flex-col gap-5">
          <FormError>{serverError}</FormError>

          <FormField
            control={form.control}
            name="name"
            label="Project name"
            required
            hint="3–120 characters, unique within your company."
            render={({ field }) => (
              <Input
                {...field}
                value={field.value ?? ""}
                autoComplete="off"
                autoFocus
                placeholder="e.g. Cebu Coastal Road Widening"
              />
            )}
          />

          <div className="grid gap-5 sm:grid-cols-2">
            <FormField
              control={form.control}
              name="startDate"
              label="Estimated start"
              required
              hint="Activities are scheduled from here."
              render={({ field }) => (
                <DateInput
                  name={field.name}
                  ref={field.ref}
                  value={field.value ?? ""}
                  onBlur={field.onBlur}
                  onValueChange={field.onChange}
                />
              )}
            />
            <FormField
              control={form.control}
              name="endDate"
              label="Estimated end"
              required
              hint={durationHint(startDate, endDate)}
              render={({ field }) => (
                <DateInput
                  name={field.name}
                  ref={field.ref}
                  value={field.value ?? ""}
                  onBlur={field.onBlur}
                  onValueChange={field.onChange}
                  min={isValidISODate(startDate) ? startDate : undefined}
                />
              )}
            />
          </div>

          <div className="grid gap-5 sm:grid-cols-2">
            <FormField
              control={form.control}
              name="budget"
              label="Estimated budget"
              required
              hint={
                budgetValue && budgetValue >= 1_000_000
                  ? `${formatPesoCompact(budgetValue)}. Activity costs are checked against it.`
                  : "In pesos. Activity costs are checked against it."
              }
              render={({ field }) => (
                <CurrencyInput
                  name={field.name}
                  ref={field.ref}
                  value={typeof field.value === "number" ? field.value : null}
                  onBlur={field.onBlur}
                  onValueChange={field.onChange}
                  placeholder="0.00"
                />
              )}
            />
            <FormField
              control={form.control}
              name="color"
              label="Card color"
              hint={`${getProjectColor(color).label}. Colors tell projects apart at a glance.`}
              render={({ field }) => (
                <ColorSwatchPicker
                  value={field.value as ProjectColorKey}
                  onValueChange={field.onChange}
                  className="min-h-11 sm:min-h-10"
                />
              )}
            />
          </div>

          <div className="grid gap-5 sm:grid-cols-2">
            <FormField
              control={form.control}
              name="siteName"
              label="Site name"
              labelAside={<Optional />}
              hint="Shown on the card and to calendar viewers."
              render={({ field }) => (
                <Input {...field} value={field.value ?? ""} placeholder="e.g. Talisay–Minglanilla segment" />
              )}
            />
            <FormField
              control={form.control}
              name="siteAddress"
              label="Site address"
              labelAside={<Optional />}
              render={({ field }) => (
                <Input {...field} value={field.value ?? ""} autoComplete="street-address" placeholder="e.g. N. Bacalso Ave, Talisay, Cebu" />
              )}
            />
          </div>

          <FormField
            control={form.control}
            name="description"
            label="Description"
            labelAside={<Optional />}
            render={({ field }) => (
              <Textarea
                {...field}
                value={field.value ?? ""}
                rows={3}
                className="min-h-20"
                placeholder="Scope, client, contract reference…"
              />
            )}
          />
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button type="submit" loading={submitting} loadingText="Creating…">
            <FolderPlus aria-hidden />
            Create project
          </Button>
        </DialogFooter>
      </form>
    </Form>
  );
}
