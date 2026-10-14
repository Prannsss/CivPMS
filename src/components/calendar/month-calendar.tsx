"use client";

/**
 * Month view of the draft calendar (spec §7). Non-working days are shaded with their reason.
 * Click, right-click, long-press (touch devices fire `contextmenu`) or Enter on a day opens its
 * panel: mark as working / non-working with an optional note, or remove the override.
 * Arrow keys move between days (Home/End: week start/end, PageUp/PageDown: month).
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Info } from "lucide-react";
import { Button, IconButton, Input, Label, Popover, PopoverContent, PopoverTrigger } from "@/components/ui";
import { addDays, formatDate, isoWeekday, type CalendarIndex } from "@/lib/domain";
import { cn } from "@/lib/utils";
import {
  describeDay,
  markDay,
  monthGrid,
  monthKey,
  removeOverride,
  shiftMonth,
  WEEKDAYS,
  type CalendarDraft,
  type DayInfo,
} from "./model";

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

function monthTitle(month: string): string {
  const [y, m] = month.split("-");
  return `${MONTHS[Number(m) - 1]} ${y}`;
}

const KIND_STYLES: Record<DayInfo["kind"], { cell: string; label: string; dot?: string }> = {
  working: { cell: "bg-surface hover:bg-surface-muted", label: "text-muted-foreground" },
  weekend: {
    cell: "bg-surface-sunken text-muted-foreground bg-[repeating-linear-gradient(135deg,transparent_0_7px,var(--border)_7px_8px)]",
    label: "text-muted-foreground",
  },
  holiday: { cell: "bg-warning-soft hover:bg-warning-soft/80", label: "text-warning-text font-medium" },
  "holiday-working": { cell: "bg-surface hover:bg-surface-muted", label: "text-muted-foreground", dot: "bg-warning" },
  "override-off": { cell: "bg-orange-soft hover:bg-orange-soft/80", label: "text-orange-text font-medium" },
  "override-on": { cell: "bg-primary-soft hover:bg-primary-soft/80", label: "text-primary-text font-medium" },
};

function statusText(info: DayInfo): string {
  switch (info.kind) {
    case "working":
      return "Working day";
    case "weekend":
      return info.holiday ? `Non-working · ${info.holiday.name}` : "Non-working · not a working weekday";
    case "holiday":
      return `Non-working · Holiday: ${info.holiday?.name ?? ""}`;
    case "holiday-working":
      return `Working day · Holiday (${info.holiday?.name ?? ""}) counted as working`;
    case "override-off":
      return info.override?.note ? `Non-working (override) · ${info.override.note}` : "Non-working (override)";
    case "override-on":
      return info.override?.note ? `Working (override) · ${info.override.note}` : "Working (override)";
  }
}

export function MonthCalendar({
  draft,
  index,
  today,
  projectStart,
  projectEnd,
  canEdit,
  onChange,
}: {
  draft: CalendarDraft;
  index: CalendarIndex | null;
  today: string;
  projectStart: string;
  projectEnd: string;
  canEdit: boolean;
  onChange: (draft: CalendarDraft) => void;
}) {
  const initialMonth = today >= projectStart && today <= projectEnd ? monthKey(today) : monthKey(projectStart);
  const [month, setMonth] = useState(initialMonth);
  const [openDate, setOpenDate] = useState<string | null>(null);
  const [focusDate, setFocusDate] = useState<string>(
    monthKey(today) === initialMonth ? today : `${initialMonth}-01`,
  );
  const pendingFocus = useRef<string | null>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const weeks = useMemo(() => monthGrid(month), [month]);

  useEffect(() => {
    if (!pendingFocus.current) return;
    const target = gridRef.current?.querySelector<HTMLButtonElement>(`[data-date="${pendingFocus.current}"]`);
    pendingFocus.current = null;
    target?.focus();
  }, [month, focusDate]);

  function goTo(date: string) {
    pendingFocus.current = date;
    setFocusDate(date);
    if (monthKey(date) !== month) setMonth(monthKey(date));
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLButtonElement>, date: string) {
    const weekday = isoWeekday(date);
    const moves: Record<string, () => string> = {
      ArrowLeft: () => addDays(date, -1),
      ArrowRight: () => addDays(date, 1),
      ArrowUp: () => addDays(date, -7),
      ArrowDown: () => addDays(date, 7),
      Home: () => addDays(date, 1 - weekday),
      End: () => addDays(date, 7 - weekday),
      PageUp: () => `${shiftMonth(monthKey(date), -1)}-01`,
      PageDown: () => `${shiftMonth(monthKey(date), 1)}-01`,
    };
    const move = moves[event.key];
    if (move) {
      event.preventDefault();
      goTo(move());
    } else if (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10")) {
      event.preventDefault();
      setOpenDate(date);
    }
  }

  const navMonth = (delta: number) => {
    const next = shiftMonth(month, delta);
    setMonth(next);
    setFocusDate(monthKey(today) === next ? today : `${next}-01`);
  };

  return (
    <section
      aria-labelledby="calendar-month-title"
      className="flex min-w-0 flex-col gap-4 rounded-lg border border-border bg-surface p-4 shadow-xs sm:p-6"
      data-testid="calendar-month"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-col">
          <h2
            id="calendar-month-title"
            aria-live="polite"
            className="text-lg leading-[1.625rem] font-semibold tracking-[-0.01em] text-foreground"
          >
            {monthTitle(month)}
          </h2>
          <p className="text-xs leading-4 text-muted-foreground tabular-nums">
            Project runs {formatDate(projectStart)} – {formatDate(projectEnd)}
          </p>
        </div>
        <div className="flex items-center gap-1">
          <IconButton aria-label="Previous month" variant="outline" size="sm" onClick={() => navMonth(-1)}>
            <ChevronLeft />
          </IconButton>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setMonth(monthKey(today));
              setFocusDate(today);
            }}
            disabled={monthKey(today) === month}
          >
            Today
          </Button>
          <IconButton aria-label="Next month" variant="outline" size="sm" onClick={() => navMonth(1)}>
            <ChevronRight />
          </IconButton>
        </div>
      </div>

      <div ref={gridRef} role="grid" aria-labelledby="calendar-month-title" className="flex flex-col gap-1">
        <div role="row" className="grid grid-cols-7 gap-1">
          {WEEKDAYS.map((w) => (
            <div
              key={w.day}
              role="columnheader"
              aria-label={w.long}
              className={cn(
                "pb-1 text-center text-xs leading-4 font-medium",
                draft.workDays.includes(w.day) ? "text-foreground" : "text-muted-foreground",
              )}
            >
              <span className="sm:hidden">{w.short.slice(0, 1)}</span>
              <span className="hidden sm:inline">{w.short}</span>
            </div>
          ))}
        </div>
        {weeks.map((week) => (
          <div role="row" key={week[0]!.date} className="grid grid-cols-7 gap-1">
            {week.map((cell) => {
              const info = describeDay(draft, index, cell.date);
              const style = KIND_STYLES[info.kind];
              const isToday = cell.date === today;
              const inProject = cell.date >= projectStart && cell.date <= projectEnd;
              const accessible = `${formatDate(cell.date)}, ${statusText(info)}${isToday ? ", today" : ""}`;
              return (
                <div role="gridcell" key={cell.date} aria-selected={openDate === cell.date}>
                  <Popover open={openDate === cell.date} onOpenChange={(open) => setOpenDate(open ? cell.date : null)}>
                    <PopoverTrigger asChild>
                      <button
                        type="button"
                        data-date={cell.date}
                        data-kind={info.kind}
                        data-working={info.working}
                        tabIndex={cell.date === focusDate ? 0 : -1}
                        aria-label={accessible}
                        onFocus={() => setFocusDate(cell.date)}
                        onKeyDown={(event) => onKeyDown(event, cell.date)}
                        onContextMenu={(event) => {
                          event.preventDefault();
                          setOpenDate(cell.date);
                        }}
                        className={cn(
                          "relative flex h-14 w-full flex-col items-start gap-0.5 overflow-hidden rounded-md border border-transparent p-1.5 text-left transition-colors sm:h-[5.25rem] sm:p-2",
                          "focus-visible:z-10 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring",
                          style.cell,
                          !cell.inMonth && "opacity-45",
                          inProject && cell.inMonth && "border-border",
                          openDate === cell.date && "border-primary ring-2 ring-primary/30",
                        )}
                      >
                        <span className="flex w-full items-center justify-between gap-1">
                          <span
                            className={cn(
                              "grid size-6 place-items-center rounded-full text-xs font-semibold tabular-nums sm:text-[13px]",
                              isToday ? "bg-primary text-primary-foreground" : info.working ? "text-foreground" : "",
                            )}
                          >
                            {cell.day}
                          </span>
                          {style.dot ? <span aria-hidden className={cn("size-1.5 rounded-full", style.dot)} /> : null}
                        </span>
                        {info.label ? (
                          <span
                            aria-hidden
                            className={cn(
                              "line-clamp-2 hidden w-full text-[11px] leading-[0.9rem] sm:block",
                              style.label,
                            )}
                          >
                            {info.label}
                          </span>
                        ) : null}
                        {info.kind !== "working" ? (
                          <span
                            aria-hidden
                            className={cn(
                              "absolute right-1.5 bottom-1.5 size-1.5 rounded-full sm:hidden",
                              info.kind === "weekend" && "bg-border-strong",
                              info.kind === "holiday" && "bg-warning",
                              info.kind === "holiday-working" && "bg-warning",
                              info.kind === "override-off" && "bg-orange",
                              info.kind === "override-on" && "bg-primary",
                            )}
                          />
                        ) : null}
                      </button>
                    </PopoverTrigger>
                    <PopoverContent align="start" className="w-72 p-0" data-testid="calendar-day-panel">
                      <DayPanel
                        key={cell.date}
                        date={cell.date}
                        info={info}
                        canEdit={canEdit}
                        onApply={(next) => {
                          onChange(next(draft));
                          setOpenDate(null);
                        }}
                      />
                    </PopoverContent>
                  </Popover>
                </div>
              );
            })}
          </div>
        ))}
      </div>

      <Legend />
      <p className="flex items-start gap-1.5 text-xs leading-4 text-muted-foreground">
        <Info aria-hidden className="mt-px size-3.5 shrink-0" />
        {canEdit
          ? "Click or right-click a day (long-press on touch) to mark it as working or non-working. Use the arrow keys to move between days."
          : "Click a day to see why it is working or non-working."}
      </p>
    </section>
  );
}

function DayPanel({
  date,
  info,
  canEdit,
  onApply,
}: {
  date: string;
  info: DayInfo;
  canEdit: boolean;
  onApply: (fn: (draft: CalendarDraft) => CalendarDraft) => void;
}) {
  const [note, setNote] = useState(info.override?.note ?? "");
  const weekday = WEEKDAYS[isoWeekday(date) - 1]!.long;
  return (
    <div className="flex flex-col">
      <div className="flex flex-col gap-1 border-b border-border px-4 py-3">
        <p className="text-xs leading-4 text-muted-foreground">{weekday}</p>
        <p className="text-sm leading-5 font-semibold text-foreground tabular-nums">{formatDate(date)}</p>
        <p className={cn("text-[13px] leading-5", info.working ? "text-foreground" : "text-muted-foreground")}>
          {statusText(info)}
        </p>
      </div>
      {canEdit ? (
        <form
          className="flex flex-col gap-3 px-4 py-3"
          onSubmit={(event) => {
            event.preventDefault();
            onApply((d) => markDay(d, date, !info.working, note));
          }}
        >
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`note-${date}`}>
              Note <span className="font-normal text-muted-foreground">(optional)</span>
            </Label>
            <Input
              id={`note-${date}`}
              value={note}
              maxLength={200}
              placeholder={info.working ? "e.g. Typhoon — site closed" : "e.g. Make-up work day"}
              onChange={(event) => setNote(event.target.value)}
            />
          </div>
          <Button type="submit" size="sm" variant={info.working ? "outline" : "primary"}>
            {info.working ? "Mark as non-working day" : "Mark as working day"}
          </Button>
          {info.override ? (
            <Button type="button" size="sm" variant="ghost" onClick={() => onApply((d) => removeOverride(d, date))}>
              Remove override
            </Button>
          ) : null}
        </form>
      ) : null}
    </div>
  );
}

function Legend() {
  const items = [
    { label: "Working day", className: "border border-border bg-surface" },
    { label: "Rest day / weekend", className: "bg-surface-sunken border border-border" },
    { label: "Holiday", className: "bg-warning-soft border border-warning/40" },
    { label: "Non-working override", className: "bg-orange-soft border border-orange/40" },
    { label: "Working override", className: "bg-primary-soft border border-primary/40" },
  ];
  return (
    <ul aria-label="Legend" className="flex flex-wrap gap-x-4 gap-y-2 text-xs leading-4 text-muted-foreground">
      {items.map((item) => (
        <li key={item.label} className="flex items-center gap-1.5">
          <span aria-hidden className={cn("size-3.5 rounded-[4px]", item.className)} />
          {item.label}
        </li>
      ))}
      <li className="flex items-center gap-1.5">
        <span aria-hidden className="grid size-4 place-items-center rounded-full bg-primary text-[9px] font-semibold text-primary-foreground">
          1
        </span>
        Today
      </li>
    </ul>
  );
}
