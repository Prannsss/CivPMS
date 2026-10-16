"use client";

import {
  Controller,
  FormProvider,
  useFormContext,
  type ControllerFieldState,
  type ControllerProps,
  type ControllerRenderProps,
  type FieldPath,
  type FieldValues,
  type UseFormStateReturn,
} from "react-hook-form";
import { CircleAlert } from "lucide-react";
import { cn } from "@/lib/utils";
import { Field } from "./field";

/** Alias of react-hook-form's FormProvider: `<Form {...form}><form onSubmit={form.handleSubmit(onSubmit)}>…` */
export const Form = FormProvider;

export type FormFieldProps<
  TFieldValues extends FieldValues = FieldValues,
  TName extends FieldPath<TFieldValues> = FieldPath<TFieldValues>,
> = Omit<ControllerProps<TFieldValues, TName>, "render"> & {
  label?: React.ReactNode;
  hint?: React.ReactNode;
  required?: boolean;
  labelAside?: React.ReactNode;
  className?: string;
  render: (args: {
    field: ControllerRenderProps<TFieldValues, TName>;
    fieldState: ControllerFieldState;
    formState: UseFormStateReturn<TFieldValues>;
  }) => React.ReactElement;
};

/**
 * A react-hook-form Controller rendered inside a <Field>: label, hint and the zod error message are
 * wired automatically (aria-invalid / aria-describedby). Use with `mode: "onTouched"` so errors show
 * on blur and on submit.
 *
 * <FormField control={form.control} name="name" label="Project name" required
 *   render={({ field }) => <Input {...field} />} />
 */
export function FormField<
  TFieldValues extends FieldValues = FieldValues,
  TName extends FieldPath<TFieldValues> = FieldPath<TFieldValues>,
>({ label, hint, required, labelAside, className, render, ...controllerProps }: FormFieldProps<TFieldValues, TName>) {
  return (
    <Controller
      {...controllerProps}
      render={(args) => (
        <Field
          label={label}
          hint={hint}
          required={required}
          labelAside={labelAside}
          error={args.fieldState.error?.message}
          disabled={args.field.disabled}
          className={className}
        >
          {render(args)}
        </Field>
      )}
    />
  );
}

/** Form-level error (e.g. a server ActionResult error without a field). */
export function FormError({ className, children, ...props }: React.ComponentProps<"div">) {
  if (!children) return null;
  return (
    <div
      role="alert"
      className={cn(
        "flex items-start gap-2.5 rounded-md border border-danger/30 bg-danger-soft px-3.5 py-3 text-sm text-danger-text",
        className,
      )}
      {...props}
    >
      <CircleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
      <div className="min-w-0">{children}</div>
    </div>
  );
}

/** Reads the root `errors.root.serverError` (or another key) from the nearest <Form>. */
export function useFormRootError(key = "serverError"): string | undefined {
  const { formState } = useFormContext();
  const root = formState.errors.root as Record<string, { message?: string } | undefined> | undefined;
  return root?.[key]?.message;
}
