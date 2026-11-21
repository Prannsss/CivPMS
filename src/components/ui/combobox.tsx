"use client";

import * as React from "react";
import { Check, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { matchesQuery } from "./combobox-filter";
import { controlClasses } from "./control-classes";
import { useFieldControlProps } from "./field";
import { Popover, PopoverAnchor, PopoverContent } from "./popover";

export type ComboboxOption = {
  value: string;
  label: string;
  /** Extra words that should also find this option (e.g. an email next to a name). */
  keywords?: string[];
};

export type ComboboxProps = {
  options: ComboboxOption[];
  /** Selected option value; `null` shows the placeholder. */
  value: string | null;
  onValueChange: (value: string) => void;
  /** Shown when nothing is selected. */
  placeholder?: string;
  /** Shown when the search finds nothing: say what happened and how to fix it. */
  emptyMessage?: string;
  invalid?: boolean;
  disabled?: boolean;
  id?: string;
  "aria-label"?: string;
  "aria-describedby"?: string;
  /** Classes for the input (size, shape, background). */
  className?: string;
  /** Classes for the drop-down panel. */
  contentClassName?: string;
};

/**
 * Pick one option from a list that can grow with the data (projects, people). The input is the
 * search box: click or start typing to filter, ↑/↓ to move, Enter to pick, Esc to close. While
 * open, the current choice stays visible as the placeholder. Follows the WAI-ARIA "combobox with
 * listbox popup" pattern (focus stays in the input; the active option is `aria-activedescendant`).
 * Use `Select` instead for short fixed lists (sort order, expiry), where typing adds nothing.
 */
export function Combobox({
  options,
  value,
  onValueChange,
  placeholder = "Select…",
  emptyMessage = "No matches. Check the spelling or try fewer letters.",
  invalid,
  disabled,
  id,
  "aria-label": ariaLabel,
  "aria-describedby": ariaDescribedBy,
  className,
  contentClassName,
}: ComboboxProps) {
  const controlProps = useFieldControlProps({ id, disabled, invalid, "aria-describedby": ariaDescribedBy });
  const listId = React.useId();
  const inputRef = React.useRef<HTMLInputElement>(null);
  const anchorRef = React.useRef<HTMLDivElement>(null);
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState("");
  const [active, setActive] = React.useState<string | null>(null);

  const selected = options.find((option) => option.value === value) ?? null;
  const filtered = React.useMemo(
    () => options.filter((option) => matchesQuery([option.label, ...(option.keywords ?? [])].join(" "), query)),
    [options, query],
  );
  // The highlighted option, kept valid while the list is being filtered.
  const activeValue = filtered.some((option) => option.value === active) ? active : (filtered[0]?.value ?? null);
  const indexOf = React.useMemo(() => new Map(options.map((option, index) => [option.value, index])), [options]);
  const optionId = (optionValue: string) => `${listId}-${indexOf.get(optionValue)}`;
  const activeId = open && activeValue ? optionId(activeValue) : undefined;

  function openList() {
    if (disabled || open) return;
    setQuery("");
    setActive(value);
    setOpen(true);
  }

  function close() {
    setOpen(false);
    setQuery("");
  }

  function choose(option: ComboboxOption) {
    close();
    if (option.value !== value) onValueChange(option.value);
  }

  function move(step: 1 | -1) {
    if (filtered.length === 0) return;
    const index = filtered.findIndex((option) => option.value === activeValue);
    const next = (index + step + filtered.length) % filtered.length;
    setActive(filtered[next].value);
  }

  React.useEffect(() => {
    if (activeId) document.getElementById(activeId)?.scrollIntoView({ block: "nearest" });
  }, [activeId]);

  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    switch (event.key) {
      case "ArrowDown":
      case "ArrowUp":
        event.preventDefault();
        if (!open) openList();
        else move(event.key === "ArrowDown" ? 1 : -1);
        break;
      case "Enter": {
        if (!open) return;
        event.preventDefault();
        const option = filtered.find((item) => item.value === activeValue);
        if (option) choose(option);
        break;
      }
      case "Tab":
        if (open) close();
        break;
      // Escape is handled by the popover layer (it closes only the top-most layer).
    }
  }

  return (
    <Popover open={open} onOpenChange={(next) => (next ? openList() : close())}>
      <PopoverAnchor asChild>
        <div ref={anchorRef} className="relative w-full">
          <input
            ref={inputRef}
            type="text"
            role="combobox"
            aria-label={ariaLabel}
            aria-expanded={open}
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={activeId}
            autoComplete="off"
            autoCapitalize="off"
            spellCheck={false}
            {...controlProps}
            value={open ? query : (selected?.label ?? "")}
            placeholder={open && selected ? selected.label : placeholder}
            onChange={(event) => {
              setQuery(event.target.value);
              setActive(null);
              if (!open) setOpen(true);
            }}
            onClick={openList}
            onKeyDown={onKeyDown}
            onBlur={(event) => {
              if (!anchorRef.current?.contains(event.relatedTarget as Node | null)) close();
            }}
            className={cn(
              controlClasses,
              "h-11 truncate pr-10 pl-3.5 sm:h-10",
              open && "border-primary ring-[3px] ring-primary/20",
              className,
            )}
          />
          <ChevronDown
            aria-hidden
            className={cn(
              "pointer-events-none absolute top-1/2 right-3.5 size-4 -translate-y-1/2 text-muted-foreground transition-transform duration-150 ease-in-out",
              open && "rotate-180",
            )}
          />
        </div>
      </PopoverAnchor>
      <PopoverContent
        align="start"
        sideOffset={6}
        // Focus stays in the input: it is the search box.
        onOpenAutoFocus={(event) => event.preventDefault()}
        onCloseAutoFocus={(event) => event.preventDefault()}
        onInteractOutside={(event) => {
          if (anchorRef.current?.contains(event.target as Node)) event.preventDefault();
        }}
        // Clicks inside the panel (options, scrollbar, padding) must not blur the input.
        onMouseDown={(event) => event.preventDefault()}
        className={cn("w-(--radix-popover-trigger-width) min-w-48 overflow-hidden p-1", contentClassName)}
      >
        <ul
          id={listId}
          role="listbox"
          aria-label={ariaLabel}
          className="max-h-[min(18rem,calc(var(--radix-popover-content-available-height)-0.5rem))] overflow-y-auto overscroll-contain"
        >
          {filtered.map((option) => {
            const isSelected = option.value === value;
            return (
              <li
                key={option.value}
                id={optionId(option.value)}
                role="option"
                aria-selected={isSelected}
                data-active={option.value === activeValue ? "" : undefined}
                onMouseMove={() => option.value !== activeValue && setActive(option.value)}
                onClick={() => choose(option)}
                className={cn(
                  "relative flex min-h-10 cursor-default items-center rounded-sm py-2 pr-9 pl-2.5 text-sm select-none sm:min-h-9",
                  "data-[active]:bg-surface-sunken aria-selected:font-medium",
                )}
              >
                <span className="truncate">{option.label}</span>
                {isSelected ? (
                  <Check aria-hidden className="absolute right-2.5 size-4 text-primary-text" />
                ) : null}
              </li>
            );
          })}
        </ul>
        {filtered.length === 0 ? (
          <p role="status" className="px-3 py-5 text-center text-sm text-muted-foreground">
            {emptyMessage}
          </p>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}
