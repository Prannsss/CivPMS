"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import { formatGrouped, parseDecimal } from "./format";
import { Input, type InputProps } from "./input";

export type CurrencyInputProps = Omit<InputProps, "value" | "defaultValue" | "onChange" | "type" | "leading"> & {
  /** Amount in pesos, or null when empty. */
  value: number | null | undefined;
  /** Emits the parsed number (rounded to 2 decimals) or null when the field is cleared. */
  onValueChange: (value: number | null) => void;
  /** Currency symbol shown as a prefix. */
  symbol?: string;
};

function toDraft(value: number | null | undefined, focused: boolean): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "";
  return focused ? String(value) : formatGrouped(value);
}

/**
 * Peso amount input: shows `₱` as a prefix, accepts digits/commas/decimal point, and formats with
 * thousands separators on blur (`1,250,000.00`). Emits a number, never a string.
 */
export function CurrencyInput({
  value,
  onValueChange,
  symbol = "₱",
  onBlur,
  onFocus,
  className,
  ...props
}: CurrencyInputProps) {
  const [focused, setFocused] = useState(false);
  const [draft, setDraft] = useState<string | null>(null);

  // While focused the user's raw text is shown; otherwise the formatted prop value.
  const display = focused && draft !== null ? draft : toDraft(value, false);

  return (
    <Input
      type="text"
      inputMode="decimal"
      autoComplete="off"
      leading={<span className="text-sm font-medium text-muted-foreground">{symbol}</span>}
      className={cn("tabular-nums", className)}
      value={display}
      onFocus={(event) => {
        setFocused(true);
        setDraft(toDraft(value, true));
        onFocus?.(event);
      }}
      onChange={(event) => {
        const next = event.target.value;
        if (!/^[\d,]*\.?\d{0,2}$/.test(next.replace(/\s/g, ""))) return; // ignore invalid keystrokes
        setDraft(next);
        const parsed = parseDecimal(next);
        onValueChange(parsed === null ? null : Math.round(parsed * 100) / 100);
      }}
      onBlur={(event) => {
        setFocused(false);
        setDraft(null);
        onBlur?.(event);
      }}
      {...props}
    />
  );
}
