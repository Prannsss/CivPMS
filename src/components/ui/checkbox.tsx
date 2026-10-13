"use client";

import { useId } from "react";
import { Checkbox as CheckboxPrimitive } from "radix-ui";
import { Check, Minus } from "lucide-react";
import { cn } from "@/lib/utils";
import { useFieldControlProps } from "./field";

export type CheckboxProps = React.ComponentProps<typeof CheckboxPrimitive.Root> & {
  /** Optional inline label (clickable). */
  label?: React.ReactNode;
  /** Optional secondary line under the label. */
  description?: React.ReactNode;
  invalid?: boolean;
};

export function Checkbox({ className, label, description, invalid, id, ...props }: CheckboxProps) {
  const generatedId = useId();
  const controlProps = useFieldControlProps({ ...props, id, invalid });
  const controlId = controlProps.id ?? `checkbox-${generatedId}`;
  const descriptionId = description ? `${controlId}-description` : undefined;

  const box = (
    <CheckboxPrimitive.Root
      data-slot="checkbox"
      {...controlProps}
      id={controlId}
      aria-describedby={[controlProps["aria-describedby"], descriptionId].filter(Boolean).join(" ") || undefined}
      className={cn(
        "peer grid size-5 shrink-0 place-items-center rounded-[6px] border-[1.5px] border-input bg-surface text-primary-foreground",
        "transition-[background-color,border-color] duration-150 focus-ring",
        "hover:border-muted-foreground",
        "data-[state=checked]:border-primary data-[state=checked]:bg-primary data-[state=indeterminate]:border-primary data-[state=indeterminate]:bg-primary",
        "aria-invalid:border-danger",
        "disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
    >
      <CheckboxPrimitive.Indicator className="grid place-items-center">
        {props.checked === "indeterminate" ? (
          <Minus aria-hidden className="size-3.5" strokeWidth={3} />
        ) : (
          <Check aria-hidden className="size-3.5" strokeWidth={3} />
        )}
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  );

  if (!label) return box;

  return (
    <div className="flex items-start gap-3">
      <div className="flex h-5 items-center">{box}</div>
      <div className="grid gap-0.5">
        <label
          htmlFor={controlId}
          className="cursor-pointer text-sm leading-5 font-medium text-foreground peer-disabled:cursor-not-allowed"
        >
          {label}
        </label>
        {description ? (
          <p id={descriptionId} className="text-xs leading-4 text-muted-foreground">
            {description}
          </p>
        ) : null}
      </div>
    </div>
  );
}
