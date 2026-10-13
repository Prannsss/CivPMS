import type { FieldPath, FieldValues, UseFormReturn } from "react-hook-form";
import type { ActionErrorBody } from "@/lib/action-result";

/**
 * Puts a failed ActionResult onto a react-hook-form form: field errors on their fields (focusing
 * the first), everything else in `root.serverError` for the FormError banner.
 */
export function applyActionError<T extends FieldValues, C, O>(
  form: UseFormReturn<T, C, O>,
  error: ActionErrorBody,
  fields: ReadonlyArray<FieldPath<T>>,
): void {
  const entries = Object.entries(error.fieldErrors ?? {}).filter(([name]) =>
    (fields as ReadonlyArray<string>).includes(name),
  );
  entries.forEach(([name, message], index) => {
    form.setError(name as FieldPath<T>, { type: "server", message }, { shouldFocus: index === 0 });
  });
  if (entries.length === 0) {
    form.setError("root.serverError", { type: error.code, message: error.message });
  }
}
