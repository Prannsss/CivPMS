"use client";

/**
 * Add / rename dialog for WBS items. Adding a first child to a leaf that already has values shows
 * the D21 warning and offers to carry its cost, hours and dates to the new child.
 */
import { useState } from "react";
import {
  Button,
  Checkbox,
  CurrencyInput,
  DateInput,
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Field,
  Input,
} from "@/components/ui";
import {
  childLevelLabel,
  formatDate,
  formatDuration,
  formatPeso,
  levelLabel,
  parseDurationInput,
  type DurationUnit,
} from "@/lib/domain";
import { Notice } from "./notice";
import type { WbsNode } from "./types";
import type { CreateValues } from "./use-wbs-controller";

export type ActivityDialogMode =
  | { kind: "create"; parent: WbsNode | null; index?: number | null }
  | { kind: "rename"; node: WbsNode };

export type ActivityDialogProps = {
  mode: ActivityDialogMode | null;
  onOpenChange: (open: boolean) => void;
  projectStart: string;
  unit: DurationUnit;
  hoursPerDay: number;
  onCreate: (values: CreateValues) => Promise<{ ok: true } | { ok: false; message: string; fieldErrors?: Record<string, string> }>;
  onRename: (node: WbsNode, name: string) => Promise<boolean>;
};

function hasOwnValues(node: WbsNode): boolean {
  return (
    node.children.length === 0 &&
    (node.startDate !== null || node.durationHours !== null || (node.estCost !== null && node.estCost > 0))
  );
}

export function ActivityDialog(props: ActivityDialogProps) {
  const { mode, onOpenChange } = props;
  return (
    <Dialog open={mode !== null} onOpenChange={onOpenChange}>
      <DialogContent size="md" onInteractOutside={(event) => event.preventDefault()}>
        {mode ? (
          <>
            <DialogHeader>
              <DialogTitle>{dialogTitle(mode)}</DialogTitle>
              <DialogDescription>{dialogDescription(mode)}</DialogDescription>
            </DialogHeader>
            <ActivityForm key={modeKey(mode)} {...props} mode={mode} />
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function modeKey(mode: ActivityDialogMode): string {
  return mode.kind === "rename" ? `rename-${mode.node.id}` : `create-${mode.parent?.id ?? "root"}-${mode.index ?? "end"}`;
}

function dialogTitle(mode: ActivityDialogMode): string {
  if (mode.kind === "rename") return `Rename ${levelLabel(mode.node.level).toLowerCase()}`;
  if (!mode.parent) return "Add deliverable";
  return `Add ${(childLevelLabel(mode.parent.level) ?? "work package").toLowerCase()}`;
}

function dialogDescription(mode: ActivityDialogMode): string {
  if (mode.kind === "rename") return `${mode.node.wbsCode} ${mode.node.name}`;
  if (!mode.parent) return "Deliverables are the top level of the work breakdown, like “Earthworks” or “Drainage”.";
  return `Under ${mode.parent.wbsCode} ${mode.parent.name}.`;
}

function ActivityForm({
  mode,
  onOpenChange,
  projectStart,
  unit,
  hoursPerDay,
  onCreate,
  onRename,
}: ActivityDialogProps & { mode: ActivityDialogMode }) {
  const isRename = mode.kind === "rename";
  const parent = mode.kind === "create" ? mode.parent : null;
  const parentHasValues = parent ? hasOwnValues(parent) : false;
  const childLabel = parent ? (childLevelLabel(parent.level) ?? "Work package") : "Deliverable";

  const [name, setName] = useState(isRename ? mode.node.name : "");
  // Empty by default so an item without a schedule doesn't get a stray start date; a duration
  // without a start date starts on the parent's (or the project's) start.
  const defaultStart = parent?.startDate ?? projectStart;
  const [startDate, setStartDate] = useState("");
  const [duration, setDuration] = useState("");
  const [cost, setCost] = useState<number | null>(null);
  const [carry, setCarry] = useState(true);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const nextErrors: Record<string, string> = {};
    const trimmed = name.trim();
    if (!trimmed) nextErrors.name = "Enter a name, like “Clearing and grubbing”.";
    else if (trimmed.length > 200) nextErrors.name = "Use 200 characters or fewer for the name.";

    let durationHours: number | null = null;
    if (!isRename && duration.trim()) {
      durationHours = parseDurationInput(duration, unit, hoursPerDay);
      if (durationHours === null) {
        nextErrors.durationHours = `Enter a number of ${unit}, like ${unit === "days" ? "5" : "40"}. Use 0 for a milestone.`;
      }
    }
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) return;

    setSubmitting(true);
    setFormError(null);
    if (isRename) {
      const saved = trimmed === mode.node.name ? true : await onRename(mode.node, trimmed);
      setSubmitting(false);
      if (saved) onOpenChange(false);
      return;
    }

    const carryNow = parentHasValues && carry;
    const result = await onCreate({
      parentId: parent?.id ?? null,
      name: trimmed,
      index: mode.kind === "create" ? (mode.index ?? null) : null,
      carryFromParent: carryNow,
      ...(carryNow
        ? {}
        : {
            startDate: startDate || (durationHours !== null ? defaultStart : null),
            durationHours,
            estCost: cost,
          }),
    });
    setSubmitting(false);
    if (result.ok) {
      onOpenChange(false);
      return;
    }
    const fe = result.fieldErrors ?? {};
    setErrors({
      name: fe.name ?? "",
      startDate: fe.startDate ?? fe.start_date ?? "",
      durationHours: fe.durationHours ?? fe.duration_hours ?? "",
      estCost: fe.estCost ?? fe.est_cost ?? "",
    });
    setFormError(result.message);
  }

  return (
    <form onSubmit={submit} noValidate className="flex min-h-0 flex-1 flex-col">
      <DialogBody className="flex flex-col gap-5">
      {formError ? (
        <p role="alert" className="rounded-md bg-danger-soft px-3 py-2 text-[13px] leading-5 font-medium text-danger-text">
          {formError}
        </p>
      ) : null}
      <Field label="Name" required error={errors.name || undefined}>
        <Input
          autoFocus
          value={name}
          maxLength={220}
          placeholder={isRename ? undefined : childLabel === "Deliverable" ? "e.g. Earthworks" : "e.g. Excavation for footings"}
          onChange={(event) => setName(event.target.value)}
        />
      </Field>

      {!isRename && parentHasValues && parent ? (
        <Notice
          tone="warning"
          title={`${parent.wbsCode} ${parent.name} will become a parent`}
        >
          <p>
            Parents take their dates, hours and cost from their work packages, so its own values (
            {[
              parent.startDate ? `starts ${formatDate(parent.startDate)}` : null,
              parent.durationHours !== null ? formatDuration(parent.durationHours, unit, hoursPerDay) : null,
              parent.estCost ? formatPeso(parent.estCost) : null,
            ]
              .filter(Boolean)
              .join(", ")}
            ) will stop counting.
          </p>
          <Checkbox
            className="mt-0.5"
            checked={carry}
            onCheckedChange={(value) => setCarry(value === true)}
            label={<span className="text-[13px]">Move them to this new {childLabel.toLowerCase()}</span>}
          />
        </Notice>
      ) : null}

      {!isRename && !(parentHasValues && carry) ? (
        <fieldset className="flex flex-col gap-4 rounded-lg border border-border bg-surface-muted/60 p-4">
          <legend className="px-1 text-[13px] leading-5 font-medium text-foreground">
            Schedule and cost <span className="font-normal text-muted-foreground">(optional)</span>
          </legend>
          <p className="-mt-1 text-xs leading-4 text-muted-foreground">
            Add them now or later in the list. The end date is worked out from the project calendar.
          </p>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label="Start date"
              error={errors.startDate || undefined}
              hint={`Empty = ${formatDate(defaultStart)} when a duration is set`}
            >
              <DateInput value={startDate} onValueChange={setStartDate} />
            </Field>
            <Field
              label={`Duration (${unit === "days" ? "working days" : "working hours"})`}
              error={errors.durationHours || undefined}
              hint={unit === "days" ? `1 day = ${hoursPerDay} h` : "0 = milestone"}
            >
              <Input
                inputMode="decimal"
                value={duration}
                placeholder={unit === "days" ? "e.g. 5" : "e.g. 40"}
                onChange={(event) => setDuration(event.target.value)}
                className="tabular-nums"
              />
            </Field>
          </div>
          <Field label="Estimated cost" error={errors.estCost || undefined}>
            <CurrencyInput value={cost} onValueChange={setCost} placeholder="0.00" />
          </Field>
        </fieldset>
      ) : null}

      </DialogBody>
      <DialogFooter>
        <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
          Cancel
        </Button>
        <Button type="submit" loading={submitting} loadingText={isRename ? "Saving…" : "Adding…"}>
          {isRename ? "Save name" : `Add ${childLabel.toLowerCase()}`}
        </Button>
      </DialogFooter>
    </form>
  );
}
