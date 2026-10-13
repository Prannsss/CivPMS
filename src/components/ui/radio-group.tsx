"use client";

import { useId } from "react";
import { RadioGroup as RadioGroupPrimitive } from "radix-ui";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { useFieldContext, useFieldControlProps } from "./field";

export function RadioGroup({ className, ...props }: React.ComponentProps<typeof RadioGroupPrimitive.Root>) {
  const field = useFieldContext();
  // A radio group is not labelable by <label for>, so point aria-labelledby at the Field label.
  const { id: _fieldControlId, ...controlProps } = useFieldControlProps(props);
  void _fieldControlId;
  return (
    <RadioGroupPrimitive.Root
      data-slot="radio-group"
      aria-labelledby={props["aria-labelledby"] ?? (field?.hasLabel ? field.labelId : undefined)}
      className={cn("grid gap-3", className)}
      {...controlProps}
    />
  );
}

export type RadioGroupItemProps = React.ComponentProps<typeof RadioGroupPrimitive.Item> & {
  label?: React.ReactNode;
  description?: React.ReactNode;
};

export function RadioGroupItem({ className, label, description, id, ...props }: RadioGroupItemProps) {
  const generatedId = useId();
  const itemId = id ?? `radio-${generatedId}`;
  const descriptionId = description ? `${itemId}-description` : undefined;

  const radio = (
    <RadioGroupPrimitive.Item
      id={itemId}
      aria-describedby={descriptionId}
      className={cn(
        "peer grid size-5 shrink-0 place-items-center rounded-full border-[1.5px] border-input bg-surface",
        "transition-colors duration-150 focus-ring hover:border-muted-foreground",
        "data-[state=checked]:border-primary",
        "disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      {...props}
    >
      <RadioGroupPrimitive.Indicator className="size-2.5 rounded-full bg-primary" />
    </RadioGroupPrimitive.Item>
  );

  if (!label) return radio;

  return (
    <div className="flex items-start gap-3">
      <div className="flex h-5 items-center">{radio}</div>
      <div className="grid gap-0.5">
        <label htmlFor={itemId} className="cursor-pointer text-sm leading-5 font-medium text-foreground">
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

export type ChoiceCardProps = Omit<React.ComponentProps<typeof RadioGroupPrimitive.Item>, "children"> & {
  title: React.ReactNode;
  description?: React.ReactNode;
  /** Large icon shown in a tinted tile (e.g. HardHat for Project Manager). */
  icon?: React.ReactNode;
  /** Extra content under the description, e.g. a list of what the role can do. */
  footer?: React.ReactNode;
};

/**
 * Big selectable card for single-choice questions (onboarding role picker, templates).
 * Must be used inside <RadioGroup>; arrow keys move between cards.
 */
export function ChoiceCard({ className, title, description, icon, footer, ...props }: ChoiceCardProps) {
  const titleId = useId();
  const descriptionId = useId();
  return (
    <RadioGroupPrimitive.Item
      data-slot="choice-card"
      aria-labelledby={titleId}
      aria-describedby={description ? descriptionId : undefined}
      className={cn(
        "group relative flex w-full items-start gap-4 rounded-lg border-[1.5px] border-border-strong bg-surface p-4 text-left sm:p-5",
        "transition-[border-color,background-color,box-shadow] duration-150 ease-out focus-ring",
        "hover:border-input hover:bg-surface-muted",
        "data-[state=checked]:border-primary data-[state=checked]:bg-primary-soft data-[state=checked]:shadow-sm",
        "disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      {...props}
    >
      {icon ? (
        <span
          aria-hidden
          className="grid size-11 shrink-0 place-items-center rounded-md bg-surface-sunken text-muted-foreground transition-colors group-data-[state=checked]:bg-primary group-data-[state=checked]:text-primary-foreground [&_svg:not([class*='size-'])]:size-5"
        >
          {icon}
        </span>
      ) : null}
      <span className="grid min-w-0 flex-1 gap-1 pr-7">
        <span id={titleId} className="text-[15px] leading-6 font-semibold text-foreground">
          {title}
        </span>
        {description ? (
          <span id={descriptionId} className="text-[13px] leading-5 text-muted-foreground">
            {description}
          </span>
        ) : null}
        {footer ? <span className="mt-2 block">{footer}</span> : null}
      </span>
      <span
        aria-hidden
        className="absolute top-4 right-4 grid size-5 place-items-center rounded-full border-[1.5px] border-input bg-surface text-primary-foreground transition-colors group-data-[state=checked]:border-primary group-data-[state=checked]:bg-primary sm:top-5 sm:right-5"
      >
        <Check className="size-3 opacity-0 group-data-[state=checked]:opacity-100" strokeWidth={3.5} />
      </span>
    </RadioGroupPrimitive.Item>
  );
}
