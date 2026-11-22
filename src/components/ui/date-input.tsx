"use client";

import { useRef, useState } from "react";
import { Popover as PopoverPrimitive } from "radix-ui";
import { CalendarDays } from "lucide-react";
import { addDays, addMonths, endOfMonth, formatDate, parseDateEntry, todayInManila, type ISODate } from "@/lib/domain";
import { cn } from "@/lib/utils";
import { CalendarGrid } from "./calendar-grid";
import { Input, type InputProps } from "./input";

export type DateInputProps = Omit<InputProps, "type" | "value" | "defaultValue" | "onChange" | "onBlur" | "min" | "max"> & {
  /** ISO calendar date `YYYY-MM-DD` ("" when empty). */
  value: string;
  onValueChange: (value: string) => void;
  /** Called when focus leaves the field and its calendar (not when it moves between them). */
  onBlur?: () => void;
  /** Earliest selectable date, `YYYY-MM-DD`. */
  min?: string;
  /** Latest selectable date, `YYYY-MM-DD`. */
  max?: string;
};

const QUICK_PICKS: { label: string; date: (today: ISODate) => ISODate }[] = [
  { label: "Today", date: (t) => t },
  { label: "Tomorrow", date: (t) => addDays(t, 1) },
  { label: "In 1 week", date: (t) => addDays(t, 7) },
  { label: "In 2 weeks", date: (t) => addDays(t, 14) },
  { label: "In 1 month", date: (t) => addMonths(t, 1) },
  { label: "End of month", date: (t) => endOfMonth(t) },
];

/**
 * Date field (Cloudflare-style): shows `25 Oct 2026`, accepts typing (`2026-10-25`, `25/10/2026`,
 * `25 Oct`, `tomorrow`, `+2w`) and opens a calendar with quick picks from the button on the right.
 * Values stay ISO strings (`YYYY-MM-DD`), as everywhere in CivPMS. A typed value that isn't a date
 * reverts to the last good one when the field loses focus.
 */
export function DateInput({
  value,
  onValueChange,
  onBlur,
  min,
  max,
  className,
  disabled,
  ref,
  onKeyDown,
  placeholder = "e.g. 25 Oct 2026",
  ...props
}: DateInputProps) {
  const [today] = useState(() => todayInManila());
  const [text, setText] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [month, setMonth] = useState<ISODate>(value || today);
  const [focusDate, setFocusDate] = useState<ISODate>(value || today);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const closeReason = useRef<"select" | "escape" | "outside" | null>(null);

  const typedInvalid = text !== null && text.trim() !== "" && parseDateEntry(text, today) === null;
  const shown = text ?? (value ? formatDate(value) : "");
  const outOfRange = (date: ISODate) => (min ? date < min : false) || (max ? date > max : false);

  function inside(node: EventTarget | null) {
    return node instanceof Node && (wrapRef.current?.contains(node) || contentRef.current?.contains(node));
  }

  function setRefs(node: HTMLInputElement | null) {
    inputRef.current = node;
    if (typeof ref === "function") ref(node);
    else if (ref) ref.current = node;
  }

  function openCalendar(next: boolean) {
    if (next) {
      const start = value || today;
      setMonth(start);
      setFocusDate(start);
    }
    setOpen(next);
  }

  function pick(date: ISODate) {
    closeReason.current = "select";
    setText(null);
    onValueChange(date);
    setOpen(false);
  }

  return (
    <PopoverPrimitive.Root open={open} onOpenChange={openCalendar}>
      <PopoverPrimitive.Anchor asChild>
        <div ref={wrapRef} className="w-full">
          <Input
            {...props}
            ref={setRefs}
            value={shown}
            disabled={disabled}
            placeholder={placeholder}
            autoComplete="off"
            inputMode="text"
            invalid={props.invalid || typedInvalid || undefined}
            className={cn("tabular-nums", className)}
            onChange={(event) => {
              const next = event.target.value;
              setText(next);
              if (next.trim() === "") onValueChange("");
              else {
                const parsed = parseDateEntry(next, today);
                if (parsed) onValueChange(parsed);
              }
            }}
            onKeyDown={(event) => {
              if (event.key === "ArrowDown" && event.altKey) {
                event.preventDefault();
                openCalendar(true);
                return;
              }
              if (event.key === "Enter" && text !== null) setText(null);
              onKeyDown?.(event);
            }}
            onBlur={(event) => {
              if (inside(event.relatedTarget)) return;
              setText(null);
              onBlur?.();
            }}
            trailing={
              <PopoverPrimitive.Trigger asChild disabled={disabled}>
                <button
                  type="button"
                  aria-label={open ? "Close calendar" : "Open calendar"}
                  className="grid size-9 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-surface-sunken hover:text-foreground focus-ring disabled:pointer-events-none disabled:opacity-50 sm:size-8"
                >
                  <CalendarDays aria-hidden className="size-4" />
                </button>
              </PopoverPrimitive.Trigger>
            }
          />
        </div>
      </PopoverPrimitive.Anchor>
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content
          ref={contentRef}
          align="start"
          sideOffset={6}
          collisionPadding={12}
          onOpenAutoFocus={(event) => event.preventDefault()}
          onEscapeKeyDown={() => {
            closeReason.current = "escape";
          }}
          onInteractOutside={() => {
            closeReason.current = "outside";
          }}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            const reason = closeReason.current;
            closeReason.current = null;
            if (reason !== "outside") {
              inputRef.current?.focus();
              return;
            }
            // Closed by a click elsewhere: if focus left the field for good, that's a blur.
            window.setTimeout(() => {
              if (!inside(document.activeElement)) onBlur?.();
            }, 0);
          }}
          className={cn(
            "z-50 flex w-[min(var(--radix-popover-content-available-width),30rem)] max-w-[calc(100vw-1.5rem)] flex-col overflow-hidden rounded-md border border-border bg-surface text-foreground shadow-popover outline-none sm:flex-row",
            "origin-(--radix-popover-content-transform-origin) data-[state=open]:animate-pop-in data-[state=closed]:animate-pop-out",
          )}
        >
          <div className="min-w-0 flex-1 p-3 sm:p-4">
            <CalendarGrid
              month={month}
              onMonthChange={setMonth}
              focusDate={focusDate}
              onFocusDateChange={setFocusDate}
              today={today}
              selected={value || null}
              min={min ?? null}
              max={max ?? null}
              onSelect={pick}
              autoFocus
            />
          </div>
          <div className="flex shrink-0 gap-1 overflow-x-auto border-t border-border p-2 sm:w-40 sm:flex-col sm:overflow-visible sm:border-t-0 sm:border-l sm:p-3">
            {QUICK_PICKS.map((quick) => {
              const date = quick.date(today);
              const isCurrent = value === date;
              return (
                <button
                  key={quick.label}
                  type="button"
                  disabled={outOfRange(date)}
                  onClick={() => pick(date)}
                  className={cn(
                    "flex h-9 shrink-0 items-center rounded-md px-3 text-left text-sm whitespace-nowrap transition-colors focus-ring disabled:pointer-events-none disabled:opacity-40 max-sm:rounded-full max-sm:border max-sm:border-border",
                    isCurrent ? "bg-primary-soft font-medium text-primary-text" : "text-foreground hover:bg-surface-sunken",
                  )}
                >
                  {quick.label}
                </button>
              );
            })}
          </div>
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  );
}
