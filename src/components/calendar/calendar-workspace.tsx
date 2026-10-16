"use client";

/**
 * Working calendar screen (spec §7). Every change is staged locally; "Save changes" asks the
 * server which work packages would move ("14 activities will move"), confirms with the list, then
 * saves settings, dates and the rescheduled end dates in one transaction (logged by DB triggers).
 */
import { useCallback, useMemo, useState } from "react";
import { CalendarCheck, Undo2 } from "lucide-react";
import {
  Button,
  Card,
  Checkbox,
  Field,
  Input,
  PageHeader,
  Switch,
  toast,
  useConfirm,
} from "@/components/ui";
import { formatDate, pluralize } from "@/lib/domain";
import { cn } from "@/lib/utils";
import {
  previewCalendarChange,
  saveCalendar,
  type CalendarDraftInput,
  type CalendarMove,
} from "@/server/actions/calendar";
import type { ProjectCalendar } from "@/server/queries/calendar";
import { Notice } from "@/components/wbs/notice";
import { DateLists } from "./date-lists";
import { MonthCalendar } from "./month-calendar";
import {
  countChanges,
  safeIndex,
  toDraft,
  toggleWorkDay,
  withoutWeekends,
  WEEKDAYS,
  type CalendarDraft,
} from "./model";

export type CalendarLockReason = "role" | "completed" | "cancelled" | null;

const LOCK_COPY = {
  role: {
    title: "View only",
    body: "Only the project's PMs and the Owner PM can change the working calendar.",
  },
  completed: {
    title: "This project is completed, so its calendar is locked",
    body: "Reopen the project from Project settings to change working days or holidays.",
  },
  cancelled: {
    title: "This project is cancelled, so its calendar is locked",
    body: "Cancelled projects keep their calendar for the record.",
  },
} as const;

function toInput(projectId: string, draft: CalendarDraft): CalendarDraftInput {
  return {
    projectId,
    settings: {
      workDays: draft.workDays,
      hoursPerDay: draft.hoursPerDay,
      holidaysNonWorking: draft.holidaysNonWorking,
    },
    holidays: draft.holidays,
    overrides: draft.overrides,
  };
}

function MovesList({ moves }: { moves: CalendarMove[] }) {
  const shown = moves.slice(0, 8);
  return (
    <span className="flex flex-col gap-3">
      <span>Their start dates and durations stay the same; their end dates follow the new calendar.</span>
      <span className="flex max-h-56 flex-col divide-y divide-border overflow-y-auto rounded-md border border-border bg-surface-muted text-left">
        {shown.map((m) => (
          <span key={m.id} className="flex flex-col gap-0.5 px-3 py-2 text-[13px] leading-5">
            <span className="flex min-w-0 gap-2 text-foreground">
              <span className="shrink-0 font-mono text-xs leading-5 text-muted-foreground">{m.wbsCode}</span>
              <span className="truncate font-medium">{m.name}</span>
            </span>
            <span className="text-xs text-muted-foreground tabular-nums">
              Ends {m.previousEndDate ? formatDate(m.previousEndDate) : "—"} → {formatDate(m.endDate)}
            </span>
          </span>
        ))}
      </span>
      {moves.length > shown.length ? (
        <span className="text-xs">and {pluralize(moves.length - shown.length, "more work package")}.</span>
      ) : null}
    </span>
  );
}

export function CalendarWorkspace({
  projectId,
  projectStart,
  projectEnd,
  calendar,
  today,
  lockReason,
}: {
  projectId: string;
  projectStart: string;
  projectEnd: string;
  calendar: ProjectCalendar;
  today: string;
  lockReason: CalendarLockReason;
}) {
  const canEdit = lockReason === null;
  const confirm = useConfirm();
  const saved = useMemo(() => toDraft(calendar), [calendar]);
  const [syncedFrom, setSyncedFrom] = useState(calendar);
  const [draft, setDraft] = useState<CalendarDraft>(saved);
  // The hours field is uncontrolled (keeps text typed before hydration); bump the key to reset it.
  const [hoursKey, setHoursKey] = useState(0);
  const [hoursError, setHoursError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Fresh server data after a save (revalidation) becomes the new baseline.
  if (syncedFrom !== calendar) {
    setSyncedFrom(calendar);
    setDraft(saved);
    setHoursKey((k) => k + 1);
    setHoursError(null);
  }

  const index = useMemo(() => safeIndex(draft), [draft]);
  const changes = useMemo(() => countChanges(saved, draft), [saved, draft]);
  const dirty = changes.total > 0;

  const update = useCallback((fn: (d: CalendarDraft) => CalendarDraft) => setDraft((d) => fn(d)), []);

  function commitHours(raw: string) {
    const value = Number(raw.replace(",", ".").trim());
    if (!raw.trim() || !Number.isFinite(value)) {
      setHoursError("Enter the working hours per day as a number, like 8 or 7.5.");
      return;
    }
    if (value < 1 || value > 24) {
      setHoursError("Hours per day must be between 1 and 24.");
      return;
    }
    if (Math.round(value * 100) !== value * 100) {
      setHoursError("Use at most 2 decimal places, like 7.5.");
      return;
    }
    setHoursError(null);
    update((d) => ({ ...d, hoursPerDay: value }));
  }

  function discard() {
    setDraft(saved);
    setHoursKey((k) => k + 1);
    setHoursError(null);
  }

  async function save() {
    if (hoursError) {
      toast.error("Fix the hours per day first", { description: hoursError });
      return;
    }
    if (draft.workDays.length === 0) {
      toast.error("Choose at least one working day", { description: "Work can't be scheduled without working days." });
      return;
    }
    setSaving(true);
    const input = toInput(projectId, draft);
    const preview = await previewCalendarChange(input);
    if (!preview.ok) {
      setSaving(false);
      toast.error("Couldn't check the schedule", { description: preview.error.message });
      return;
    }
    const moves = preview.data.moves;
    if (moves.length > 0) {
      const ok = await confirm({
        title: `${pluralize(moves.length, "work package")} will move`,
        description: <MovesList moves={moves} />,
        confirmLabel: "Save and reschedule",
        icon: <CalendarCheck />,
      });
      if (!ok) {
        setSaving(false);
        return;
      }
    }
    const result = await saveCalendar(input);
    setSaving(false);
    if (!result.ok) {
      toast.error("Couldn't save the calendar", { description: result.error.message });
      return;
    }
    toast.success("Calendar saved", {
      description:
        result.data.rescheduled > 0
          ? `${pluralize(result.data.rescheduled, "work package")} rescheduled.`
          : "No work package dates changed.",
    });
  }

  const lock = lockReason ? LOCK_COPY[lockReason] : null;
  const allWeekendsOff = !draft.workDays.includes(6) && !draft.workDays.includes(7);

  return (
    <div className="flex min-w-0 flex-col gap-5 pb-24" data-testid="calendar-workspace">
      <PageHeader
        className="pb-0 sm:pb-0"
        title="Calendar"
        description="Working days, hours, holidays and site exceptions. Work package end dates follow this calendar."
      />

      {lock ? (
        <Notice tone="neutral" title={lock.title} data-testid="calendar-lock">
          {lock.body}
        </Notice>
      ) : null}

      <Card className="gap-5 p-5 sm:p-6" data-testid="calendar-settings">
        <div className="flex flex-col gap-1">
          <h2 className="text-base leading-6 font-semibold tracking-[-0.01em] text-foreground">Working time</h2>
          <p className="text-[13px] leading-5 text-muted-foreground">
            Durations are counted in working hours on these days only.
          </p>
        </div>
        <fieldset className="flex min-w-0 flex-col gap-3">
          <legend className="mb-3 text-[13px] leading-5 font-medium text-foreground">Working days</legend>
          <div className="grid max-w-3xl grid-cols-4 gap-1.5 sm:grid-cols-7 sm:gap-2">
            {WEEKDAYS.map((w) => {
              const checked = draft.workDays.includes(w.day);
              return (
                <label
                  key={w.day}
                  className={cn(
                    "flex min-h-11 items-center gap-1.5 rounded-md border px-2 text-sm font-medium sm:gap-2 sm:px-3 transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring",
                    checked ? "border-primary/40 bg-primary-soft text-foreground" : "border-border bg-surface text-muted-foreground",
                    canEdit ? "cursor-pointer" : "cursor-default",
                  )}
                >
                  <Checkbox
                    checked={checked}
                    disabled={!canEdit}
                    aria-label={w.long}
                    onCheckedChange={(value) => update((d) => toggleWorkDay(d, w.day, value === true))}
                  />
                  <span aria-hidden>{w.short}</span>
                </label>
              );
            })}
          </div>
          {draft.workDays.length === 0 ? (
            <p role="alert" className="text-xs font-medium text-danger-text">
              Choose at least one working day.
            </p>
          ) : canEdit && !allWeekendsOff ? (
            <div>
              <Button variant="link" size="sm" className="h-auto px-0" onClick={() => update(withoutWeekends)}>
                Mark all weekends as non-working
              </Button>
            </div>
          ) : null}
        </fieldset>
        <div className="grid gap-6 border-t border-border pt-5 sm:grid-cols-2">
          <Field
            label="Working hours per day"
            error={hoursError ?? undefined}
            hint="1–24 hours. At 8 h/day, a 16-hour work package takes 2 days."
          >
            <Input
              key={hoursKey}
              inputMode="decimal"
              defaultValue={String(draft.hoursPerDay)}
              disabled={!canEdit}
              trailing={<span className="text-xs font-medium text-muted-foreground">h/day</span>}
              className="tabular-nums"
              wrapperClassName="max-w-44"
              onBlur={(event) => commitHours(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") commitHours(event.currentTarget.value);
              }}
            />
          </Field>
          <Switch
            checked={draft.holidaysNonWorking}
            disabled={!canEdit}
            onCheckedChange={(value) => update((d) => ({ ...d, holidaysNonWorking: value }))}
            label="Mark all holidays as non-working"
            description="When off, holidays stay listed but work continues on them."
          />
        </div>
      </Card>

      <div className="grid min-w-0 gap-5 xl:grid-cols-[minmax(0,1fr)_23rem]">
        <MonthCalendar
          draft={draft}
          index={index}
          today={today}
          projectStart={projectStart}
          projectEnd={projectEnd}
          canEdit={canEdit}
          onChange={setDraft}
        />
        <DateLists draft={draft} canEdit={canEdit} onChange={setDraft} />
      </div>

      {canEdit && dirty ? (
        <div
          role="region"
          aria-label="Unsaved calendar changes"
          data-testid="calendar-savebar"
          className="sticky bottom-4 z-20 flex flex-col gap-3 rounded-lg border border-border bg-surface p-3 pl-4 shadow-lg sm:flex-row sm:items-center sm:justify-between"
        >
          <p className="text-sm leading-5 text-foreground">
            <span className="font-semibold">Unsaved changes</span>
            <span className="text-muted-foreground">
              {" "}
              ·{" "}
              {[
                changes.settings ? pluralize(changes.settings, "setting") : null,
                changes.holidays ? pluralize(changes.holidays, "holiday") : null,
                changes.overrides ? pluralize(changes.overrides, "day override") : null,
              ]
                .filter(Boolean)
                .join(", ")}
            </span>
          </p>
          <div className="flex flex-col-reverse gap-2 sm:flex-row">
            <Button variant="ghost" onClick={discard} disabled={saving}>
              <Undo2 /> Discard
            </Button>
            <Button onClick={save} loading={saving} loadingText="Saving…">
              Save changes
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
