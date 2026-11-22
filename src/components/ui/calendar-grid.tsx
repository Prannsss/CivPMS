"use client";

import { useEffect, useRef } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { addDays, addMonths, isoWeekday, monthGrid, startOfMonth, type ISODate } from "@/lib/domain";
import { cn } from "@/lib/utils";

const WEEKDAYS = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"] as const;
const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
] as const;

function monthLabel(month: ISODate): string {
  return `${MONTH_NAMES[Number(month.slice(5, 7)) - 1]} ${month.slice(0, 4)}`;
}

function longLabel(date: ISODate): string {
  const weekday = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"][isoWeekday(date) - 1];
  return `${weekday}, ${Number(date.slice(8, 10))} ${MONTH_NAMES[Number(date.slice(5, 7)) - 1]} ${date.slice(0, 4)}`;
}

export type CalendarGridProps = {
  /** Any day in the month to show. */
  month: ISODate;
  onMonthChange: (month: ISODate) => void;
  /** The day that keyboard focus starts on and moves from. */
  focusDate: ISODate;
  onFocusDateChange: (date: ISODate) => void;
  today: ISODate;
  onSelect: (date: ISODate) => void;
  /** Single selection. */
  selected?: ISODate | null;
  /** Range selection (inclusive); `to` may be missing while the second end is being picked. */
  range?: { from: ISODate | null; to: ISODate | null } | null;
  /** Hovered day while picking a range's second end (preview shading). */
  onHoverDate?: (date: ISODate | null) => void;
  hoverDate?: ISODate | null;
  min?: ISODate | null;
  max?: ISODate | null;
  /** Move DOM focus to `focusDate` when the grid appears. */
  autoFocus?: boolean;
  className?: string;
};

/**
 * Month calendar for the date pickers (Monday first, like the project calendars). Keyboard: arrows
 * move a day/week, Home/End go to the week's ends, PageUp/PageDown change month (Shift: year),
 * Enter/Space pick. Only the focused day is in the tab order (roving tabindex).
 */
export function CalendarGrid({
  month,
  onMonthChange,
  focusDate,
  onFocusDateChange,
  today,
  onSelect,
  selected = null,
  range = null,
  onHoverDate,
  hoverDate = null,
  min = null,
  max = null,
  autoFocus = false,
  className,
}: CalendarGridProps) {
  const gridRef = useRef<HTMLDivElement>(null);
  const shouldFocus = useRef(autoFocus);
  const shown = startOfMonth(month);
  const weeks = monthGrid(shown);
  const disabled = (date: ISODate) => (min !== null && date < min) || (max !== null && date > max);

  // Range shading, including the hover preview while the second end is open.
  let lo: ISODate | null = null;
  let hi: ISODate | null = null;
  if (range?.from) {
    const end = range.to ?? hoverDate ?? range.from;
    [lo, hi] = range.from <= end ? [range.from, end] : [end, range.from];
  }

  useEffect(() => {
    if (!shouldFocus.current) return;
    const button = gridRef.current?.querySelector<HTMLButtonElement>(`[data-date="${focusDate}"]`);
    if (button) {
      button.focus();
    }
  }, [focusDate, shown]);

  function move(next: ISODate) {
    shouldFocus.current = true;
    onFocusDateChange(next);
    if (startOfMonth(next) !== shown) onMonthChange(startOfMonth(next));
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLButtonElement>, date: ISODate) {
    const weekday = isoWeekday(date);
    const keys: Record<string, () => ISODate> = {
      ArrowLeft: () => addDays(date, -1),
      ArrowRight: () => addDays(date, 1),
      ArrowUp: () => addDays(date, -7),
      ArrowDown: () => addDays(date, 7),
      Home: () => addDays(date, 1 - weekday),
      End: () => addDays(date, 7 - weekday),
      PageUp: () => addMonths(date, event.shiftKey ? -12 : -1),
      PageDown: () => addMonths(date, event.shiftKey ? 12 : 1),
    };
    const go = keys[event.key];
    if (!go) return;
    event.preventDefault();
    move(go());
  }

  return (
    <div className={cn("flex w-full flex-col gap-3", className)}>
      <div className="flex items-center justify-between gap-2">
        <p aria-live="polite" className="text-[15px] leading-6 font-semibold text-foreground">
          {monthLabel(shown)}
        </p>
        <div className="flex gap-1.5">
          <button
            type="button"
            aria-label="Previous month"
            onClick={() => onMonthChange(addMonths(shown, -1))}
            className="grid size-9 place-items-center rounded-md bg-surface-sunken text-foreground transition-colors hover:bg-border focus-ring"
          >
            <ChevronLeft aria-hidden className="size-4" />
          </button>
          <button
            type="button"
            aria-label="Next month"
            onClick={() => onMonthChange(addMonths(shown, 1))}
            className="grid size-9 place-items-center rounded-md bg-surface-sunken text-foreground transition-colors hover:bg-border focus-ring"
          >
            <ChevronRight aria-hidden className="size-4" />
          </button>
        </div>
      </div>

      <div ref={gridRef} role="grid" aria-label={monthLabel(shown)} onMouseLeave={() => onHoverDate?.(null)}>
        <div role="row" className="grid grid-cols-7">
          {WEEKDAYS.map((day) => (
            <span key={day} role="columnheader" className="grid h-7 place-items-center sm:h-8 text-xs font-medium text-muted-foreground">
              {day}
            </span>
          ))}
        </div>
        {weeks.map((week) => (
          <div role="row" key={week[0]} className="grid grid-cols-7">
            {week.map((date) => {
              const inMonth = startOfMonth(date) === shown;
              const isDisabled = disabled(date);
              const isSelected = selected === date || (range !== null && (date === lo || date === hi) && lo !== null);
              const inRange = lo !== null && hi !== null && date > lo && date < hi;
              const isStart = lo !== null && date === lo && hi !== lo;
              const isEnd = hi !== null && date === hi && hi !== lo;
              return (
                <div
                  role="gridcell"
                  key={date}
                  aria-selected={isSelected || inRange || undefined}
                  className={cn(
                    "relative flex h-9 items-center justify-center sm:h-10",
                    inRange && "bg-primary-soft",
                    isStart && "bg-linear-to-r from-transparent from-50% to-primary-soft to-50%",
                    isEnd && "bg-linear-to-r from-primary-soft from-50% to-transparent to-50%",
                  )}
                >
                  <button
                    type="button"
                    data-date={date}
                    tabIndex={date === focusDate ? 0 : -1}
                    disabled={isDisabled}
                    aria-label={`${longLabel(date)}${date === today ? ", today" : ""}`}
                    aria-pressed={isSelected}
                    onClick={() => {
                      onFocusDateChange(date);
                      onSelect(date);
                    }}
                    onMouseEnter={() => onHoverDate?.(date)}
                    onFocus={() => onHoverDate?.(date)}
                    onKeyDown={(event) => onKeyDown(event, date)}
                    className={cn(
                      "relative grid size-8 place-items-center rounded-md text-sm tabular-nums sm:size-9 transition-colors duration-150 focus-ring",
                      inMonth ? "text-foreground" : "text-muted-foreground/60",
                      !isSelected && !isDisabled && "hover:bg-surface-sunken",
                      isSelected && "bg-primary font-semibold text-primary-foreground shadow-xs hover:bg-primary-hover",
                      isDisabled && "cursor-not-allowed text-muted-foreground/40 line-through decoration-muted-foreground/40",
                    )}
                  >
                    {Number(date.slice(8, 10))}
                    {date === today ? (
                      <span
                        aria-hidden
                        className={cn(
                          "absolute bottom-1 left-1/2 size-1 -translate-x-1/2 rounded-full",
                          isSelected ? "bg-primary-foreground" : "bg-primary",
                        )}
                      />
                    ) : null}
                  </button>
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
