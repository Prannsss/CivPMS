"use client";

import { useRef, useState } from "react";
import { CalendarClock } from "lucide-react";
import { SettingsCard } from "@/components/profile/settings-layout";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { FormError } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/toaster";
import { cn } from "@/lib/utils";
import { updateCompanyDefaults } from "@/server/actions/company";

export const WEEKDAYS = [
  { day: 1, short: "Mon", long: "Monday" },
  { day: 2, short: "Tue", long: "Tuesday" },
  { day: 3, short: "Wed", long: "Wednesday" },
  { day: 4, short: "Thu", long: "Thursday" },
  { day: 5, short: "Fri", long: "Friday" },
  { day: 6, short: "Sat", long: "Saturday" },
  { day: 7, short: "Sun", long: "Sunday" },
] as const;

/** "Mon–Fri", "Mon–Sat", "Mon, Wed, Fri" (ISO weekdays, 1 = Monday). */
export function describeWorkDays(days: readonly number[]): string {
  const sorted = [...new Set(days)].filter((d) => d >= 1 && d <= 7).sort((a, b) => a - b);
  if (sorted.length === 0) return "No working days";
  if (sorted.length === 7) return "Every day";
  const contiguous = sorted.every((day, index) => index === 0 || day === sorted[index - 1] + 1);
  const name = (day: number) => WEEKDAYS[day - 1].short;
  if (contiguous && sorted.length >= 3) return `${name(sorted[0])}–${name(sorted[sorted.length - 1])}`;
  return sorted.map(name).join(", ");
}

function hoursText(hours: number): string {
  return Number.isInteger(hours) ? String(hours) : hours.toFixed(2).replace(/0$/, "");
}

/** Default working days and hours/day applied to NEW projects' calendars. */
export function CalendarDefaults({
  workDays,
  hoursPerDay,
  canEdit,
}: {
  workDays: number[];
  hoursPerDay: number;
  canEdit: boolean;
}) {
  const [days, setDays] = useState<number[]>(workDays);
  const [saved, setSaved] = useState({ days: workDays, hours: hoursPerDay });
  const [hours, setHours] = useState(hoursText(hoursPerDay));
  const [daysError, setDaysError] = useState<string | null>(null);
  const [hoursError, setHoursError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  // Uncontrolled (defaultValue) so text typed before hydration is kept; state mirrors it.
  const hoursRef = useRef<HTMLInputElement>(null);

  const numericHours = Number(hours);
  const weekly = Number.isFinite(numericHours) ? numericHours * days.length : null;
  const dirty =
    days.length !== saved.days.length || days.some((d, i) => d !== [...saved.days].sort((a, b) => a - b)[i]) || numericHours !== saved.hours;

  function toggle(day: number) {
    setDaysError(null);
    setDays((current) => (current.includes(day) ? current.filter((d) => d !== day) : [...current, day].sort((a, b) => a - b)));
  }

  function validateHours(value: string): string | null {
    const n = Number(value.trim());
    if (value.trim() === "" || !Number.isFinite(n)) return "Enter the working hours per day, from 1 to 24.";
    if (n < 1) return "Enter at least 1 working hour per day.";
    if (n > 24) return "A day has at most 24 hours.";
    if (Math.round(n * 100) !== n * 100) return "Use at most 2 decimals, e.g. 7.5.";
    return null;
  }

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setFormError(null);
    const currentHours = hoursRef.current?.value ?? hours;
    setHours(currentHours);
    const hoursProblem = validateHours(currentHours);
    const daysProblem = days.length === 0 ? "Pick at least one working day." : null;
    setHoursError(hoursProblem);
    setDaysError(daysProblem);
    if (hoursProblem || daysProblem) return;
    setSaving(true);
    const result = await updateCompanyDefaults({ workDays: days, hoursPerDay: Number(currentHours) });
    setSaving(false);
    if (!result.ok) {
      const fe = result.error.fieldErrors ?? {};
      if (fe.workDays) setDaysError(fe.workDays);
      if (fe.hoursPerDay) setHoursError(fe.hoursPerDay);
      if (!fe.workDays && !fe.hoursPerDay) setFormError(result.error.message);
      return;
    }
    setSaved({ days: result.data.workDays, hours: result.data.hoursPerDay });
    setDays(result.data.workDays);
    setHours(hoursText(result.data.hoursPerDay));
    if (hoursRef.current) hoursRef.current.value = hoursText(result.data.hoursPerDay);
    toast.success("Working calendar defaults saved", { description: "New projects start with these days and hours." });
  }

  const description =
    "New projects start with these working days and hours. Each project can still change its own calendar; existing projects don't change.";

  if (!canEdit) {
    return (
      <SettingsCard id="calendar" title="Working calendar" description={description}>
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap gap-2" aria-label="Default working days">
            {WEEKDAYS.map((weekday) => {
              const on = workDays.includes(weekday.day);
              return (
                <span
                  key={weekday.day}
                  className={cn(
                    "inline-flex h-9 min-w-12 items-center justify-center rounded-full px-3 text-[13px] font-medium",
                    on ? "bg-primary-soft text-primary-text" : "bg-surface-sunken text-muted-foreground line-through",
                  )}
                >
                  <span aria-hidden>{weekday.short}</span>
                  <span className="sr-only">{`${weekday.long}: ${on ? "working day" : "day off"}`}</span>
                </span>
              );
            })}
          </div>
          <p className="text-sm text-muted-foreground">
            <span className="font-medium text-foreground">{describeWorkDays(workDays)}</span> ·{" "}
            <span className="tabular-nums">{hoursText(hoursPerDay)} h per day</span> · Philippine holidays are non-working by default.
          </p>
        </div>
      </SettingsCard>
    );
  }

  return (
    <SettingsCard id="calendar" title="Working calendar" description={description}>
      <form onSubmit={onSubmit} noValidate aria-label="Working calendar defaults" className="flex flex-col gap-5">
        <FormError>{formError}</FormError>
        <fieldset className="flex flex-col gap-2.5">
          <legend className="mb-2.5 text-sm leading-5 font-medium text-foreground">Working days</legend>
          <div className="flex flex-wrap gap-2">
            {WEEKDAYS.map((weekday) => {
              const on = days.includes(weekday.day);
              return (
                <button
                  key={weekday.day}
                  type="button"
                  aria-pressed={on}
                  aria-label={weekday.long}
                  onClick={() => toggle(weekday.day)}
                  className={cn(
                    "inline-flex h-11 min-w-14 items-center justify-center rounded-full border px-3.5 text-sm font-medium transition-colors duration-150 focus-ring sm:h-10",
                    on
                      ? "border-primary bg-primary text-primary-foreground hover:bg-primary-hover"
                      : "border-border-strong bg-surface text-muted-foreground hover:bg-surface-muted hover:text-foreground",
                  )}
                >
                  {weekday.short}
                </button>
              );
            })}
          </div>
          {daysError ? (
            <p role="alert" className="text-[13px] leading-5 text-danger-text">
              {daysError}
            </p>
          ) : (
            <p className="text-[13px] leading-5 text-muted-foreground">Philippine holidays are non-working by default in every project.</p>
          )}
        </fieldset>
        <div className="grid gap-5 sm:grid-cols-[12rem_minmax(0,1fr)] sm:items-start">
          <Field label="Hours per day" required error={hoursError ?? undefined}>
            <Input
              ref={hoursRef}
              defaultValue={hoursText(hoursPerDay)}
              onChange={(event) => {
                setHours(event.target.value);
                if (hoursError) setHoursError(null);
              }}
              onBlur={(event) => setHoursError(validateHours(event.target.value))}
              inputMode="decimal"
              className="tabular-nums"
              trailing={<span className="pr-3 text-sm text-muted-foreground">h</span>}
            />
          </Field>
          <div className="flex items-center gap-3 rounded-md bg-surface-muted px-4 py-3 sm:mt-7">
            <CalendarClock aria-hidden className="size-5 shrink-0 text-muted-foreground" />
            <p className="text-[13px] leading-5 text-muted-foreground">
              <span className="font-medium text-foreground">{describeWorkDays(days)}</span>
              {weekly !== null && !hoursError ? (
                <>
                  {" "}
                  · <span className="tabular-nums">{hoursText(weekly)} working hours per week</span>
                </>
              ) : null}
            </p>
          </div>
        </div>
        <div className="flex justify-end">
          <Button type="submit" loading={saving} loadingText="Saving…" disabled={!dirty && !saving}>
            Save defaults
          </Button>
        </div>
      </form>
    </SettingsCard>
  );
}
