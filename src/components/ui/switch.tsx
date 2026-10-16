"use client";

import { useId } from "react";
import { Switch as SwitchPrimitive } from "radix-ui";
import { cn } from "@/lib/utils";
import { useFieldControlProps } from "./field";

export type SwitchProps = React.ComponentProps<typeof SwitchPrimitive.Root> & {
  label?: React.ReactNode;
  description?: React.ReactNode;
  size?: "sm" | "md";
};

export function Switch({ className, label, description, size = "md", id, ...props }: SwitchProps) {
  const generatedId = useId();
  const controlProps = useFieldControlProps({ ...props, id });
  const controlId = controlProps.id ?? `switch-${generatedId}`;
  const descriptionId = description ? `${controlId}-description` : undefined;

  const control = (
    <SwitchPrimitive.Root
      data-slot="switch"
      {...controlProps}
      id={controlId}
      aria-describedby={[controlProps["aria-describedby"], descriptionId].filter(Boolean).join(" ") || undefined}
      className={cn(
        "peer inline-flex shrink-0 items-center rounded-full border-[1.5px] border-transparent transition-colors duration-150 focus-ring",
        "bg-input data-[state=checked]:bg-primary",
        "disabled:cursor-not-allowed disabled:opacity-50",
        size === "md" ? "h-6 w-11" : "h-5 w-9",
        className,
      )}
    >
      <SwitchPrimitive.Thumb
        className={cn(
          "pointer-events-none block rounded-full bg-white shadow-sm transition-transform duration-150 ease-out",
          size === "md"
            ? "size-5 data-[state=checked]:translate-x-5"
            : "size-4 data-[state=checked]:translate-x-4",
        )}
      />
    </SwitchPrimitive.Root>
  );

  if (!label) return control;

  return (
    <div className="flex items-start justify-between gap-4">
      <div className="grid gap-0.5">
        <label htmlFor={controlId} className="cursor-pointer text-sm leading-6 font-medium text-foreground">
          {label}
        </label>
        {description ? (
          <p id={descriptionId} className="text-xs leading-4 text-muted-foreground">
            {description}
          </p>
        ) : null}
      </div>
      <div className="flex h-6 items-center">{control}</div>
    </div>
  );
}
