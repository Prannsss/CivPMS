"use client";

import { useRef, useState } from "react";
import { Popover as PopoverPrimitive } from "radix-ui";
import { CalendarRange, ChevronDown, Globe, X } from "lucide-react";
import {
  DATE_RANGE_PRESETS,
  formatDate,
  formatDateRange,
  parseRangeEntry,
  todayInManila,
  type DateRange,
  type ISODate,
} from "@/lib/domain";
import { cn } from "@/lib/utils";
import { Button } from "./button";
import { CalendarGrid } from "./calendar-grid";
import { controlClasses } from "./control-classes";
import { DateInput } from "./date-input";
import { useFieldControlProps } from "./field";

export type DateRangeValue = { from: ISODate | null; to: ISODate | null };

export type DateRangePickerProps = {
  value: DateRangeValue;
  /** Called with the applied range; `{ from: null, to: null }` clears it. */
  onApply: (value: DateRangeValue) => void;
  /** Trigger text when no range is set. */
  placeholder?: string;
  min?: ISODate;
  max?: ISODate;
  className?: string;
  id?: string;
  "aria-label"?: string;
};

function label(value: DateRangeValue): string | null {
  if (value.from && value.to) return value.from === value.to ? formatDate(value.from) : formatDateRange(value.from, value.to);
  if (value.from) return `From ${formatDate(value.from)}`;
  if (value.to) return `Until ${formatDate(value.to)}`;
  return null;
}

/**
 * Date range picker (Cloudflare-style): a typed range at the top (`7d`, `2 weeks`, `last month`,
 * `1 Oct - 15 Oct`), a calendar where two clicks pick the ends, presets on the right, exact Start
 * and End fields, the time zone, and Apply. Nothing changes until Apply; Esc or a click outside
 * keeps the old range. Dates are Philippine calendar days.
 */
export function DateRangePicker({
  value,
  onApply,
  placeholder = "Any date",
  min,
  max,
  className,
  ...props
}: DateRangePickerProps) {
  const controlProps = useFieldControlProps(props);
  const [today] = useState(() => todayInManila());
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<DateRangeValue>(value);
  const [typed, setTyped] = useState("");
  const [hover, setHover] = useState<ISODate | null>(null);
  const [month, setMonth] = useState<ISODate>(value.from ?? today);
  const [focusDate, setFocusDate] = useState<ISODate>(value.from ?? today);
  const typedRef = useRef<HTMLInputElement>(null);

  const typedRange = typed.trim() ? parseRangeEntry(typed, today) : null;
  const typedInvalid = typed.trim() !== "" && typedRange === null;
  const presetId = DATE_RANGE_PRESETS.find((p) => {
    const r = p.range(today);
    return r.from === draft.from && r.to === draft.to;
  })?.id;
  const current = label(value);

  function openPicker(next: boolean) {
    if (next) {
      setDraft(value);
      setTyped("");
      setHover(null);
      const start = value.from ?? value.to ?? today;
      setMonth(start);
      setFocusDate(start);
    }
    setOpen(next);
  }

  function showRange(range: DateRange) {
    setDraft(range);
    setMonth(range.from);
    setFocusDate(range.from);
  }

  function pickDay(date: ISODate) {
    setTyped("");
    // First click (or a click after a complete range) starts a new range; the second closes it.
    if (!draft.from || draft.to) setDraft({ from: date, to: null });
    else setDraft(date < draft.from ? { from: date, to: draft.from } : { from: draft.from, to: date });
  }

  function apply() {
    const next: DateRangeValue = draft.from && !draft.to ? { from: draft.from, to: draft.from } : draft;
    onApply(next);
    setOpen(false);
  }

  return (
    <PopoverPrimitive.Root open={open} onOpenChange={openPicker}>
      <div className={cn("relative w-full", className)}>
        <PopoverPrimitive.Trigger asChild>
          <button
            type="button"
            {...controlProps}
            className={cn(
              controlClasses,
              "flex h-11 items-center gap-2.5 pr-10 pl-3.5 text-left sm:h-10",
              !current && "text-muted-foreground",
            )}
          >
            <CalendarRange aria-hidden className="size-4 shrink-0 text-muted-foreground" />
            <span className="min-w-0 flex-1 truncate tabular-nums">{current ?? placeholder}</span>
            {current ? null : <ChevronDown aria-hidden className="size-4 shrink-0 text-muted-foreground" />}
          </button>
        </PopoverPrimitive.Trigger>
        {current ? (
          <button
            type="button"
            aria-label="Clear dates"
            onClick={() => onApply({ from: null, to: null })}
            className="absolute top-1/2 right-1 grid size-9 -translate-y-1/2 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-surface-sunken hover:text-foreground focus-ring sm:size-8"
          >
            <X aria-hidden className="size-4" />
          </button>
        ) : null}
      </div>

      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content
          align="start"
          sideOffset={6}
          collisionPadding={12}
          aria-label="Choose dates"
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            typedRef.current?.focus();
          }}
          className={cn(
            "z-50 flex max-h-(--radix-popover-content-available-height) w-[min(var(--radix-popover-content-available-width),40rem)] max-w-[calc(100vw-1.5rem)] flex-col overflow-hidden rounded-md border border-border bg-surface text-foreground shadow-popover outline-none",
            "origin-(--radix-popover-content-transform-origin) data-[state=open]:animate-pop-in data-[state=closed]:animate-pop-out",
          )}
        >
          {/* Typed range */}
          <div className="border-b border-border px-4 py-3">
            <input
              ref={typedRef}
              value={typed}
              onChange={(event) => {
                const next = event.target.value;
                setTyped(next);
                const range = next.trim() ? parseRangeEntry(next, today) : null;
                if (range) showRange(range);
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  if (typedRange) {
                    onApply(typedRange);
                    setOpen(false);
                  }
                }
              }}
              aria-label="Type a date range"
              aria-invalid={typedInvalid || undefined}
              placeholder="Custom range: 7d, 2 weeks, last month, 1 Oct - 15 Oct…"
              className={cn(
                "w-full bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground",
                typedInvalid && "text-danger-text",
              )}
            />
            {typedInvalid ? (
              <p className="mt-1 text-xs text-danger-text">Try 7d, 30 days, last month or two dates like 1 Oct - 15 Oct.</p>
            ) : null}
          </div>

          <div className="flex min-h-0 flex-col overflow-y-auto sm:flex-row">
            <div className="min-w-0 flex-1 p-4">
              <CalendarGrid
                month={month}
                onMonthChange={setMonth}
                focusDate={focusDate}
                onFocusDateChange={setFocusDate}
                today={today}
                range={draft.from ? draft : null}
                hoverDate={draft.from && !draft.to ? hover : null}
                onHoverDate={setHover}
                min={min ?? null}
                max={max ?? null}
                onSelect={pickDay}
              />
            </div>
            <div
              role="group"
              aria-label="Presets"
              className="flex shrink-0 gap-1 overflow-x-auto border-b border-border p-2 max-sm:order-first sm:w-44 sm:flex-col sm:overflow-visible sm:border-b-0 sm:border-l sm:p-3"
            >
              {DATE_RANGE_PRESETS.map((preset) => (
                <button
                  key={preset.id}
                  type="button"
                  aria-pressed={presetId === preset.id}
                  onClick={() => {
                    setTyped("");
                    showRange(preset.range(today));
                  }}
                  className={cn(
                    "flex h-9 shrink-0 items-center rounded-md px-3 text-left text-sm whitespace-nowrap transition-colors focus-ring max-sm:rounded-full max-sm:border max-sm:border-border",
                    presetId === preset.id ? "bg-primary-soft font-medium text-primary-text" : "text-foreground hover:bg-surface-sunken",
                  )}
                >
                  {preset.label}
                </button>
              ))}
            </div>
          </div>

          {/* Exact ends (phones type the range at the top instead, to keep the panel short) */}
          <div className="grid gap-3 border-t border-border px-4 py-3 max-sm:hidden sm:grid-cols-2">
            <label className="flex min-w-0 flex-col gap-1.5">
              <span className="text-label text-muted-foreground">Start</span>
              <DateInput
                value={draft.from ?? ""}
                max={draft.to ?? max}
                min={min}
                onValueChange={(next) => {
                  setTyped("");
                  setDraft((d) => ({ ...d, from: next || null }));
                  if (next) setMonth(next);
                }}
              />
            </label>
            <label className="flex min-w-0 flex-col gap-1.5">
              <span className="text-label text-muted-foreground">End</span>
              <DateInput
                value={draft.to ?? ""}
                min={draft.from ?? min}
                max={max}
                onValueChange={(next) => {
                  setTyped("");
                  setDraft((d) => ({ ...d, to: next || null }));
                  if (next) setMonth(next);
                }}
              />
            </label>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border bg-surface-muted px-4 py-3">
            <span className="inline-flex items-center gap-1.5 text-[13px] text-muted-foreground">
              <Globe aria-hidden className="size-4" />
              Philippine time (GMT+8)
            </span>
            <div className="flex gap-2">
              <Button
                variant="ghost"
                size="sm"
                className="max-sm:h-11"
                onClick={() => {
                  setTyped("");
                  setDraft({ from: null, to: null });
                }}
                disabled={!draft.from && !draft.to}
              >
                Clear
              </Button>
              <Button size="sm" className="max-sm:h-11" onClick={apply}>
                Apply
              </Button>
            </div>
          </div>
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  );
}
