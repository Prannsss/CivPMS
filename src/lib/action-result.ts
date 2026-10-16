/**
 * Server Action results (CLAUDE.md data-access rule 3). Actions never throw to the client and
 * never leak raw database text: they return `ActionResult<T>`.
 *
 * ```ts
 * "use server";
 * export async function renameProject(input: unknown) {
 *   return runAction(async () => {
 *     const parsed = projectUpdateSchema.safeParse(input);
 *     if (!parsed.success) return fromZodError(parsed.error);
 *     const supabase = await createClient();
 *     const { data, error } = await supabase.rpc("update_project", { … });
 *     if (error) return failFrom(error);             // raised RPC errors (P0001 …)
 *     revalidatePath(`/projects/${data.id}`);
 *     return ok(data);
 *   });
 * }
 * ```
 *
 * Framework-free apart from `unstable_rethrow`, which lets Next's `redirect()`/`notFound()`
 * escape `runAction` instead of being turned into an error result.
 */
import { unstable_rethrow } from "next/navigation";
import type { ZodError } from "zod";
import { fieldErrorsFrom } from "@/lib/domain/schemas";
import {
  AppException,
  DEFAULT_MESSAGES,
  appErrorFieldErrors,
  toAppError,
  type AppError,
  type ErrorCode,
} from "@/lib/errors";

export interface ActionErrorBody {
  code: ErrorCode;
  message: string;
  fieldErrors?: Record<string, string>;
}

export type ActionResult<T> = { ok: true; data: T } | { ok: false; error: ActionErrorBody };

export type ActionSuccess<T> = Extract<ActionResult<T>, { ok: true }>;
export type ActionFailure = Extract<ActionResult<never>, { ok: false }>;

export function ok(): ActionSuccess<void>;
export function ok<T>(data: T): ActionSuccess<T>;
export function ok<T>(data?: T): ActionSuccess<T | undefined> {
  return { ok: true, data };
}

/** A failed result. `message` defaults to the plain-language message for `code`. */
export function fail(code: ErrorCode, message?: string, fieldErrors?: Record<string, string>): ActionFailure {
  const error: ActionErrorBody = { code, message: message ?? DEFAULT_MESSAGES[code] };
  if (fieldErrors && Object.keys(fieldErrors).length > 0) error.fieldErrors = fieldErrors;
  return { ok: false, error };
}

/**
 * VALIDATION failure from a zod error. Field paths are joined with "." (`dates.end`); issues
 * without a path land on `_form`. When there is only a form-level issue its text is the message.
 */
export function fromZodError(error: ZodError, message?: string): ActionFailure {
  const fieldErrors = fieldErrorsFrom(error);
  const keys = Object.keys(fieldErrors);
  const formOnly = keys.length === 1 && keys[0] === "_form";
  return fail("VALIDATION", message ?? (formOnly ? fieldErrors._form : DEFAULT_MESSAGES.VALIDATION), fieldErrors);
}

/**
 * Failure from an `AppError` you already have, e.g. from `errorFromRpcResult()` for RPCs that
 * return `{ ok: false, error_code }` instead of raising (`redeem_invite_code`).
 */
export function failWith(error: AppError): ActionFailure {
  return fail(error.code, error.message, appErrorFieldErrors(error));
}

/** Failure from anything thrown or returned as an error (Supabase, fetch, AppException, …). */
export function failFrom(err: unknown): ActionFailure {
  if (err instanceof AppException && err.fieldErrors) {
    return fail(err.code, err.message, err.fieldErrors);
  }
  return failWith(toAppError(err));
}

/**
 * Runs an action body and converts anything it throws into a failed result. Next.js control-flow
 * errors (`redirect()`, `notFound()`) are re-thrown so they keep working.
 */
export async function runAction<T>(fn: () => Promise<ActionResult<T>>): Promise<ActionResult<T>> {
  try {
    return await fn();
  } catch (err) {
    unstable_rethrow(err);
    return failFrom(err);
  }
}

export function isActionFailure<T>(result: ActionResult<T>): result is ActionFailure {
  return !result.ok;
}
