"use client";

import { cn } from "@/lib/utils";
import { Input, type InputProps } from "./input";

export type DateInputProps = Omit<InputProps, "type" | "value" | "onChange" | "min" | "max"> & {
  /** ISO calendar date `YYYY-MM-DD` ("" when empty). */
  value: string;
  onValueChange: (value: string) => void;
  /** Earliest selectable date, `YYYY-MM-DD`. */
  min?: string;
  /** Latest selectable date, `YYYY-MM-DD`. */
  max?: string;
};

/**
 * Styled native date input. Calendar dates are ISO strings (`YYYY-MM-DD`) everywhere in CivPMS,
 * which is exactly what the native control emits. The picker follows the active color scheme.
 */
export function DateInput({ value, onValueChange, className, ...props }: DateInputProps) {
  return (
    <Input
      type="date"
      value={value}
      onChange={(event) => onValueChange(event.target.value)}
      className={cn("tabular-nums [&::-webkit-date-and-time-value]:text-left", !value && "text-muted-foreground", className)}
      {...props}
    />
  );
}
