"use client";

/**
 * Holidays (copied from the Philippine list when the project was created; add / rename / remove)
 * and per-date overrides (removable). Changes are staged in the draft like everything else.
 */
import { useMemo, useState } from "react";
import { CalendarOff, CalendarPlus, Pencil, Plus, Trash2 } from "lucide-react";
import {
  Badge,
  Button,
  DateInput,
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  EmptyState,
  Field,
  IconButton,
  Input,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui";
import { formatDate, isoWeekday, isValidISODate } from "@/lib/domain";
import { removeHoliday, removeOverride, upsertHoliday, WEEKDAYS, type CalendarDraft, type DraftHoliday } from "./model";

type HolidayDialogState = { mode: "add" } | { mode: "edit"; holiday: DraftHoliday } | null;

function weekdayShort(date: string): string {
  return WEEKDAYS[isoWeekday(date) - 1]!.short;
}

export function DateLists({
  draft,
  canEdit,
  onChange,
}: {
  draft: CalendarDraft;
  canEdit: boolean;
  onChange: (draft: CalendarDraft) => void;
}) {
  const [dialog, setDialog] = useState<HolidayDialogState>(null);
  const byYear = useMemo(() => {
    const groups = new Map<string, DraftHoliday[]>();
    for (const h of draft.holidays) {
      const year = h.date.slice(0, 4);
      groups.set(year, [...(groups.get(year) ?? []), h]);
    }
    return [...groups.entries()];
  }, [draft.holidays]);

  return (
    <section
      aria-label="Holidays and overrides"
      className="flex min-w-0 flex-col gap-4 rounded-lg border border-border bg-surface p-4 shadow-xs sm:p-5"
      data-testid="calendar-lists"
    >
      <Tabs defaultValue="holidays" className="flex min-h-0 flex-col gap-4">
        <TabsList className="w-full">
          <TabsTrigger value="holidays" className="flex-1">
            Holidays <span className="tabular-nums text-muted-foreground">{draft.holidays.length}</span>
          </TabsTrigger>
          <TabsTrigger value="overrides" className="flex-1">
            Overrides <span className="tabular-nums text-muted-foreground">{draft.overrides.length}</span>
          </TabsTrigger>
        </TabsList>

        <TabsContent value="holidays" className="flex flex-col gap-3">
          <div className="flex items-start justify-between gap-3">
            <p className="text-xs leading-4 text-muted-foreground">
              Philippine holidays were copied in when the project was created. Edit them for local holidays.
            </p>
            {canEdit ? (
              <Button size="sm" variant="outline" className="shrink-0" onClick={() => setDialog({ mode: "add" })}>
                <Plus /> Add
              </Button>
            ) : null}
          </div>
          {draft.holidays.length === 0 ? (
            <EmptyState
              variant="plain"
              size="sm"
              headingLevel="h3"
              icon={<CalendarPlus />}
              title="No holidays"
              description="Add the holidays your site observes so work isn't scheduled on them."
              action={
                canEdit ? (
                  <Button size="sm" onClick={() => setDialog({ mode: "add" })}>
                    <Plus /> Add holiday
                  </Button>
                ) : undefined
              }
            />
          ) : (
            <div className="-mx-1 flex max-h-[34rem] flex-col gap-4 overflow-y-auto px-1">
              {byYear.map(([year, holidays]) => (
                <div key={year} className="flex flex-col gap-1">
                  <h3 className="sticky top-0 z-10 bg-surface py-1 text-xs leading-4 font-semibold text-muted-foreground">
                    {year}
                  </h3>
                  <ul className="flex flex-col divide-y divide-border">
                    {holidays.map((h) => (
                      <li key={h.date} className="flex min-h-12 items-center gap-3 py-1.5" data-testid="calendar-holiday">
                        <span className="flex w-14 shrink-0 flex-col text-xs leading-4 tabular-nums">
                          <span className="font-semibold text-foreground">{formatDate(h.date).slice(0, -5)}</span>
                          <span className="text-muted-foreground">{weekdayShort(h.date)}</span>
                        </span>
                        <span className="min-w-0 flex-1 truncate text-[13px] leading-5 text-foreground" title={h.name}>
                          {h.name}
                        </span>
                        {canEdit ? (
                          <span className="flex shrink-0 items-center">
                            <IconButton
                              aria-label={`Rename ${h.name}`}
                              size="sm"
                              variant="ghost"
                              onClick={() => setDialog({ mode: "edit", holiday: h })}
                            >
                              <Pencil />
                            </IconButton>
                            <IconButton
                              aria-label={`Remove ${h.name} (${formatDate(h.date)})`}
                              size="sm"
                              variant="ghost"
                              className="text-danger-text hover:bg-danger-soft hover:text-danger-text"
                              onClick={() => onChange(removeHoliday(draft, h.date))}
                            >
                              <Trash2 />
                            </IconButton>
                          </span>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="overrides" className="flex flex-col gap-3">
          <p className="text-xs leading-4 text-muted-foreground">
            Single days that differ from the weekly pattern, like a typhoon closure or a Saturday make-up day.
          </p>
          {draft.overrides.length === 0 ? (
            <EmptyState
              variant="plain"
              size="sm"
              headingLevel="h3"
              icon={<CalendarOff />}
              title="No overrides"
              description={
                canEdit
                  ? "Click or right-click a day in the calendar to mark it as working or non-working."
                  : "Every day follows the weekly pattern and the holiday list."
              }
            />
          ) : (
            <ul className="flex max-h-[34rem] flex-col divide-y divide-border overflow-y-auto">
              {draft.overrides.map((o) => (
                <li key={o.date} className="flex min-h-12 items-center gap-3 py-1.5" data-testid="calendar-override">
                  <span className="flex w-24 shrink-0 flex-col text-xs leading-4 tabular-nums">
                    <span className="font-semibold text-foreground">{formatDate(o.date)}</span>
                    <span className="text-muted-foreground">{weekdayShort(o.date)}</span>
                  </span>
                  <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <Badge size="sm" tone={o.kind === "working" ? "primary" : "orange"} className="self-start">
                      {o.kind === "working" ? "Working" : "Non-working"}
                    </Badge>
                    {o.note ? (
                      <span className="truncate text-xs leading-4 text-muted-foreground" title={o.note}>
                        {o.note}
                      </span>
                    ) : null}
                  </span>
                  {canEdit ? (
                    <IconButton
                      aria-label={`Remove override on ${formatDate(o.date)}`}
                      size="sm"
                      variant="ghost"
                      className="text-danger-text hover:bg-danger-soft hover:text-danger-text"
                      onClick={() => onChange(removeOverride(draft, o.date))}
                    >
                      <Trash2 />
                    </IconButton>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </TabsContent>
      </Tabs>

      <HolidayDialog
        state={dialog}
        holidays={draft.holidays}
        onClose={() => setDialog(null)}
        onSave={(holiday, previousDate) => {
          onChange(upsertHoliday(draft, holiday, previousDate));
          setDialog(null);
        }}
      />
    </section>
  );
}

function HolidayDialog({
  state,
  holidays,
  onClose,
  onSave,
}: {
  state: HolidayDialogState;
  holidays: DraftHoliday[];
  onClose: () => void;
  onSave: (holiday: DraftHoliday, previousDate?: string) => void;
}) {
  return (
    <Dialog open={state !== null} onOpenChange={(open) => (open ? null : onClose())}>
      <DialogContent size="sm">
        {state ? (
          <HolidayForm
            key={state.mode === "edit" ? state.holiday.date : "add"}
            state={state}
            holidays={holidays}
            onClose={onClose}
            onSave={onSave}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function HolidayForm({
  state,
  holidays,
  onClose,
  onSave,
}: {
  state: NonNullable<HolidayDialogState>;
  holidays: DraftHoliday[];
  onClose: () => void;
  onSave: (holiday: DraftHoliday, previousDate?: string) => void;
}) {
  const editing = state.mode === "edit" ? state.holiday : null;
  const [date, setDate] = useState(editing?.date ?? "");
  const [name, setName] = useState(editing?.name ?? "");
  const [errors, setErrors] = useState<{ date?: string; name?: string }>({});

  function submit(event: React.FormEvent) {
    event.preventDefault();
    const next: { date?: string; name?: string } = {};
    if (!isValidISODate(date)) next.date = "Pick the holiday's date.";
    else if (date !== editing?.date && holidays.some((h) => h.date === date)) {
      next.date = `${formatDate(date)} already has a holiday. Rename that one instead.`;
    }
    if (!name.trim()) next.name = "Enter the holiday name, like Independence Day.";
    else if (name.trim().length > 200) next.name = "Use 200 characters or fewer.";
    setErrors(next);
    if (Object.keys(next).length > 0) return;
    onSave({ date, name: name.trim() }, editing?.date);
  }

  return (
    <form onSubmit={submit} noValidate className="flex min-h-0 flex-1 flex-col">
      <DialogHeader>
        <DialogTitle>{editing ? "Edit holiday" : "Add holiday"}</DialogTitle>
        <DialogDescription>
          {editing ? `${formatDate(editing.date)} · ${editing.name}` : "Local or company holidays count like national ones."}
        </DialogDescription>
      </DialogHeader>
      <DialogBody className="flex flex-col gap-4">
        <Field label="Date" required error={errors.date}>
          <DateInput value={date} onValueChange={setDate} />
        </Field>
        <Field label="Name" required error={errors.name}>
          <Input value={name} maxLength={220} placeholder="e.g. Cebu City Charter Day" onChange={(e) => setName(e.target.value)} />
        </Field>
      </DialogBody>
      <DialogFooter>
        <Button variant="outline" onClick={onClose}>
          Cancel
        </Button>
        <Button type="submit">{editing ? "Save holiday" : "Add holiday"}</Button>
      </DialogFooter>
    </form>
  );
}
