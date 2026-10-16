"use client";

import { RadioGroup as RadioGroupPrimitive } from "radix-ui";
import { Check } from "lucide-react";
import { PROJECT_COLOR_KEYS, type ProjectColorKey } from "@/lib/constants";
import { cn } from "@/lib/utils";
import { useFieldContext } from "./field";
import { PROJECT_COLORS } from "./project-color";

export type ColorSwatchPickerProps = {
  value: ProjectColorKey;
  onValueChange: (value: ProjectColorKey) => void;
  /** Accessible name when not inside a <Field label>. */
  "aria-label"?: string;
  disabled?: boolean;
  className?: string;
  size?: "md" | "lg";
};

/** Project color picker (PROJECT_COLOR_KEYS). Radio semantics: arrow keys move, Space selects. */
export function ColorSwatchPicker({ value, onValueChange, disabled, className, size = "md", ...props }: ColorSwatchPickerProps) {
  const field = useFieldContext();
  return (
    <RadioGroupPrimitive.Root
      value={value}
      onValueChange={(next) => onValueChange(next as ProjectColorKey)}
      disabled={disabled}
      orientation="horizontal"
      aria-label={props["aria-label"] ?? (field?.hasLabel ? undefined : "Project color")}
      aria-labelledby={field?.hasLabel ? field.labelId : undefined}
      className={cn("flex flex-wrap items-center gap-2", className)}
    >
      {PROJECT_COLOR_KEYS.map((key) => {
        const color = PROJECT_COLORS[key];
        return (
          <RadioGroupPrimitive.Item
            key={key}
            value={key}
            aria-label={color.label}
            title={color.label}
            className={cn(
              "group relative grid place-items-center rounded-full text-white transition-transform duration-150 ease-out",
              "ring-offset-2 ring-offset-background hover:scale-105 focus-ring data-[state=checked]:ring-2",
              "disabled:cursor-not-allowed disabled:opacity-50",
              size === "md" ? "size-11 sm:size-9" : "size-12",
              color.gradient,
              color.ring,
            )}
          >
            <Check
              aria-hidden
              strokeWidth={3}
              className="size-4 scale-50 opacity-0 transition-[opacity,transform] duration-150 group-data-[state=checked]:scale-100 group-data-[state=checked]:opacity-100"
            />
          </RadioGroupPrimitive.Item>
        );
      })}
    </RadioGroupPrimitive.Root>
  );
}
