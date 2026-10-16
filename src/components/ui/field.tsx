"use client";

import { createContext, useContext, useId } from "react";
import { CircleAlert } from "lucide-react";
import { cn } from "@/lib/utils";
import { Label } from "./label";

type FieldContextValue = {
  id: string;
  labelId: string;
  hasLabel: boolean;
  hintId: string;
  errorId: string;
  hasHint: boolean;
  invalid: boolean;
  required: boolean;
  disabled: boolean;
};

const FieldContext = createContext<FieldContextValue | null>(null);

export function useFieldContext() {
  return useContext(FieldContext);
}

type ControlA11yProps = {
  id?: string;
  disabled?: boolean;
  required?: boolean;
  "aria-describedby"?: string;
  "aria-invalid"?: React.AriaAttributes["aria-invalid"];
};

/**
 * Merges the surrounding <Field>'s id, aria-describedby, aria-invalid and disabled state into a
 * control's own props. Every form control in components/ui calls this, so wrapping a control in a
 * <Field> is all that is needed for correct labelling.
 */
export function useFieldControlProps<P extends ControlA11yProps>(props: P & { invalid?: boolean }) {
  const field = useFieldContext();
  const { invalid, ...rest } = props;
  const isInvalid = invalid ?? field?.invalid ?? false;
  const describedBy =
    [
      rest["aria-describedby"],
      field?.hasHint ? field.hintId : undefined,
      field?.invalid ? field.errorId : undefined,
    ]
      .filter(Boolean)
      .join(" ") || undefined;
  return {
    ...rest,
    id: rest.id ?? field?.id,
    disabled: rest.disabled ?? field?.disabled,
    "aria-describedby": describedBy,
    "aria-invalid": rest["aria-invalid"] ?? (isInvalid ? true : undefined),
    "aria-required": field?.required ? true : undefined,
  } as Omit<P, "invalid">;
}

export type FieldProps = Omit<React.ComponentProps<"div">, "children"> & {
  label?: React.ReactNode;
  /** Help text shown under the control (hidden while an error is shown). */
  hint?: React.ReactNode;
  /** Error message: what is wrong and how to fix it. Presence marks the control invalid. */
  error?: React.ReactNode;
  required?: boolean;
  disabled?: boolean;
  /** Explicit control id; generated when omitted. */
  htmlFor?: string;
  /** Extra content on the label row, e.g. a "Forgot password?" link. */
  labelAside?: React.ReactNode;
  children: React.ReactNode;
};

/** Label + control + hint + error, wired with aria-describedby / aria-invalid. */
export function Field({
  label,
  hint,
  error,
  required = false,
  disabled = false,
  htmlFor,
  labelAside,
  className,
  children,
  ...props
}: FieldProps) {
  const generatedId = useId();
  const id = htmlFor ?? `field-${generatedId}`;
  const invalid = Boolean(error);
  const value: FieldContextValue = {
    id,
    labelId: `${id}-label`,
    hasLabel: Boolean(label),
    hintId: `${id}-hint`,
    errorId: `${id}-error`,
    hasHint: Boolean(hint) && !invalid,
    invalid,
    required,
    disabled,
  };

  return (
    <FieldContext.Provider value={value}>
      <div
        data-slot="field"
        data-invalid={invalid || undefined}
        className={cn("flex min-w-0 flex-col gap-1.5", className)}
        {...props}
      >
        {label || labelAside ? (
          <div className="flex items-center justify-between gap-3">
            {label ? (
              <Label id={value.labelId} htmlFor={id} required={required} className={cn(disabled && "opacity-60")}>
                {label}
              </Label>
            ) : (
              <span />
            )}
            {labelAside}
          </div>
        ) : null}
        {children}
        {invalid ? (
          <FieldError id={value.errorId}>{error}</FieldError>
        ) : hint ? (
          <FieldHint id={value.hintId}>{hint}</FieldHint>
        ) : null}
      </div>
    </FieldContext.Provider>
  );
}

export function FieldHint({ className, ...props }: React.ComponentProps<"p">) {
  return <p className={cn("text-xs leading-4 text-muted-foreground", className)} {...props} />;
}

export function FieldError({ className, children, ...props }: React.ComponentProps<"p">) {
  return (
    <p
      role="alert"
      className={cn("flex items-start gap-1.5 text-xs leading-4 font-medium text-danger-text", className)}
      {...props}
    >
      <CircleAlert aria-hidden className="mt-px size-3.5 shrink-0" />
      <span>{children}</span>
    </p>
  );
}
