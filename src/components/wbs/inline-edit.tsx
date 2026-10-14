"use client";

/**
 * Inline editors for WBS list cells (spec §9.3 "inline-edit for PMs"). A cell shows its value as a
 * button; click, Enter or F2 opens the editor; Enter or leaving the field saves, Esc cancels.
 * Invalid input stays in the editor with the reason underneath.
 */
import { useEffect, useRef, useState } from "react";
import { CurrencyInput, DateInput, Input } from "@/components/ui";
import { formatDate, parseDurationInput, type DurationUnit } from "@/lib/domain";
import { cn } from "@/lib/utils";

type DisplayProps = {
  /** Accessible description of what is edited, e.g. "start date of 1.2.1 Clearing". */
  label: string;
  children: React.ReactNode;
  align?: "left" | "right";
  disabled?: boolean;
  onOpen: () => void;
  className?: string;
};

const displayClasses =
  "group/cell -mx-2 flex min-h-9 w-[calc(100%+1rem)] items-center gap-1 rounded-sm px-2 text-left transition-colors hover:bg-surface-sunken focus-ring-inset cursor-text";

function CellButton({ label, children, align = "left", disabled, onOpen, className }: DisplayProps) {
  if (disabled) {
    return <span className={cn("flex min-h-9 items-center", align === "right" && "justify-end", className)}>{children}</span>;
  }
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onOpen}
      onKeyDown={(event) => {
        if (event.key === "F2") {
          event.preventDefault();
          onOpen();
        }
      }}
      className={cn(displayClasses, align === "right" && "justify-end text-right", className)}
    >
      {children}
    </button>
  );
}

function ErrorText({ id, children }: { id: string; children: React.ReactNode }) {
  return (
    <p id={id} role="alert" className="mt-1 max-w-64 text-left text-xs leading-4 font-medium whitespace-normal text-danger-text">
      {children}
    </p>
  );
}

/** Restores focus to the cell button after closing an editor. */
function useEditing() {
  const [editing, setEditing] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const refocus = useRef(false);
  const closed = useRef(true);
  useEffect(() => {
    if (!editing && refocus.current) {
      refocus.current = false;
      wrapperRef.current?.querySelector<HTMLButtonElement>("button")?.focus();
    }
  }, [editing]);
  return {
    editing,
    wrapperRef,
    /** True once the editor has closed (guards against a late blur after Enter/Esc). */
    isClosed: () => closed.current,
    open: () => {
      closed.current = false;
      setEditing(true);
    },
    close: (focusCell: boolean) => {
      closed.current = true;
      refocus.current = focusCell;
      setEditing(false);
    },
  };
}

// ---------------------------------------------------------------------------

export function TextCell({
  value,
  label,
  disabled,
  onCommit,
  children,
  placeholder,
}: {
  value: string;
  label: string;
  disabled?: boolean;
  onCommit: (value: string) => Promise<boolean> | void;
  children: React.ReactNode;
  placeholder?: string;
}) {
  const { editing, wrapperRef, open, close, isClosed } = useEditing();
  const [error, setError] = useState<string | null>(null);
  const errorId = `${label.replace(/\W+/g, "-")}-error`;

  async function commit(raw: string, focusCell: boolean) {
    if (isClosed()) return;
    const next = raw.trim();
    if (!next) {
      setError("Enter a name.");
      return;
    }
    if (next.length > 200) {
      setError("Use 200 characters or fewer.");
      return;
    }
    setError(null);
    close(focusCell);
    if (next !== value) await onCommit(next);
  }

  return (
    <div ref={wrapperRef} className="min-w-0 flex-1">
      {editing ? (
        <div>
          <Input
            autoFocus
            defaultValue={value}
            aria-label={label}
            placeholder={placeholder}
            invalid={Boolean(error)}
            aria-describedby={error ? errorId : undefined}
            className="h-9 sm:h-9"
            onFocus={(event) => event.currentTarget.select()}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                void commit(event.currentTarget.value, true);
              } else if (event.key === "Escape") {
                event.preventDefault();
                event.stopPropagation();
                setError(null);
                close(true);
              }
            }}
            onBlur={(event) => void commit(event.currentTarget.value, false)}
          />
          {error ? <ErrorText id={errorId}>{error}</ErrorText> : null}
        </div>
      ) : (
        <CellButton label={label} disabled={disabled} onOpen={open} className="min-w-0">
          {children}
        </CellButton>
      )}
    </div>
  );
}

export function DateCell({
  value,
  label,
  disabled,
  min,
  onCommit,
  emptyText = "Set date",
}: {
  value: string | null;
  label: string;
  disabled?: boolean;
  min?: string | null;
  onCommit: (value: string | null) => Promise<boolean> | void;
  emptyText?: string;
}) {
  const { editing, wrapperRef, open, close, isClosed } = useEditing();
  const [draft, setDraft] = useState(value ?? "");
  const [error, setError] = useState<string | null>(null);
  const errorId = `${label.replace(/\W+/g, "-")}-error`;

  function commit(focusCell: boolean) {
    if (isClosed()) return;
    const next = draft || null;
    if (next && min && next < min) {
      setError(`Pick ${formatDate(min)} or later.`);
      return;
    }
    setError(null);
    close(focusCell);
    if (next !== value) void onCommit(next);
  }

  return (
    <div ref={wrapperRef}>
      {editing ? (
        <div>
          <DateInput
            autoFocus
            value={draft}
            min={min ?? undefined}
            aria-label={label}
            invalid={Boolean(error)}
            aria-describedby={error ? errorId : undefined}
            onValueChange={setDraft}
            className="h-9 w-[9.5rem] px-2.5 text-[13px] sm:h-9"
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                commit(true);
              } else if (event.key === "Escape") {
                event.preventDefault();
                event.stopPropagation();
                setError(null);
                close(true);
              }
            }}
            onBlur={() => commit(false)}
          />
          {error ? <ErrorText id={errorId}>{error}</ErrorText> : null}
        </div>
      ) : (
        <CellButton
          label={label}
          disabled={disabled}
          onOpen={() => {
            setDraft(value ?? "");
            open();
          }}
        >
          {value ? (
            <span className="tabular-nums">{formatDate(value)}</span>
          ) : (
            <span className="text-muted-foreground">{disabled ? "—" : emptyText}</span>
          )}
        </CellButton>
      )}
    </div>
  );
}

export function DurationCell({
  hours,
  unit,
  hoursPerDay,
  label,
  disabled,
  onCommit,
  children,
}: {
  hours: number | null;
  unit: DurationUnit;
  hoursPerDay: number;
  label: string;
  disabled?: boolean;
  onCommit: (hours: number) => Promise<boolean> | void;
  children: React.ReactNode;
}) {
  const { editing, wrapperRef, open, close, isClosed } = useEditing();
  const [error, setError] = useState<string | null>(null);
  const errorId = `${label.replace(/\W+/g, "-")}-error`;
  const initial =
    hours === null ? "" : unit === "days" ? String(Math.round((hours / hoursPerDay) * 100) / 100) : String(hours);

  function commit(raw: string, focusCell: boolean) {
    if (isClosed()) return;
    if (!raw.trim()) {
      setError(null);
      close(focusCell);
      return;
    }
    const parsed = parseDurationInput(raw, unit, hoursPerDay);
    if (parsed === null) {
      setError(`Enter a number of ${unit}, like ${unit === "days" ? "5 or 2.5" : "16 or 7.5"}. Use 0 for a milestone.`);
      return;
    }
    if (parsed > 100_000) {
      setError("A duration can be at most 100,000 hours.");
      return;
    }
    setError(null);
    close(focusCell);
    if (parsed !== hours) void onCommit(parsed);
  }

  return (
    <div ref={wrapperRef} className="flex justify-end">
      {editing ? (
        <div className="flex flex-col items-end">
          <Input
            autoFocus
            defaultValue={initial}
            inputMode="decimal"
            aria-label={label}
            invalid={Boolean(error)}
            aria-describedby={error ? errorId : undefined}
            trailing={<span className="text-xs font-medium text-muted-foreground">{unit === "days" ? "d" : "h"}</span>}
            wrapperClassName="w-24"
            className="h-9 pr-8 text-right tabular-nums sm:h-9"
            onFocus={(event) => event.currentTarget.select()}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                commit(event.currentTarget.value, true);
              } else if (event.key === "Escape") {
                event.preventDefault();
                event.stopPropagation();
                setError(null);
                close(true);
              }
            }}
            onBlur={(event) => commit(event.currentTarget.value, false)}
          />
          {error ? <ErrorText id={errorId}>{error}</ErrorText> : null}
        </div>
      ) : (
        <CellButton label={label} disabled={disabled} onOpen={open} align="right">
          {children}
        </CellButton>
      )}
    </div>
  );
}

export function CostCell({
  value,
  label,
  disabled,
  onDraft,
  onCommit,
  children,
}: {
  value: number | null;
  label: string;
  disabled?: boolean;
  /** Live value while typing (drives the budget allocation bar); undefined when the editor closes. */
  onDraft?: (value: number | null | undefined) => void;
  onCommit: (value: number | null) => Promise<boolean> | void;
  children: React.ReactNode;
}) {
  const { editing, wrapperRef, open, close, isClosed } = useEditing();
  const [draft, setDraft] = useState<number | null>(value);
  const cancelled = useRef(false);

  function finish(focusCell: boolean) {
    if (isClosed()) return;
    onDraft?.(undefined);
    close(focusCell);
    if (cancelled.current) {
      cancelled.current = false;
      return;
    }
    if (draft !== value) void onCommit(draft);
  }

  return (
    <div ref={wrapperRef} className="flex justify-end">
      {editing ? (
        <CurrencyInput
          autoFocus
          value={draft}
          aria-label={label}
          wrapperClassName="w-40"
          className="h-9 text-right sm:h-9"
          onValueChange={(next) => {
            setDraft(next);
            onDraft?.(next);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              event.currentTarget.blur();
            } else if (event.key === "Escape") {
              event.preventDefault();
              event.stopPropagation();
              cancelled.current = true;
              event.currentTarget.blur();
            }
          }}
          onBlur={() => finish(true)}
        />
      ) : (
        <CellButton
          label={label}
          disabled={disabled}
          align="right"
          onOpen={() => {
            setDraft(value);
            open();
          }}
        >
          {children}
        </CellButton>
      )}
    </div>
  );
}
