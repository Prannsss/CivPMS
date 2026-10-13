/**
 * Stable error codes and plain-language messages (spec §17.2, CLAUDE.md data-access rule 5).
 *
 * `toAppError(err)` turns anything thrown or returned by Supabase (RPC `P0001` errors, PostgREST
 * errors, Auth errors), zod, the domain module or `fetch` into an `AppError` the UI can show.
 * Raw database or provider text never reaches the user: only the human `detail` that our own
 * RPCs write is passed through. Anything unrecognised becomes `UNEXPECTED` with a reference id
 * that is logged server-side.
 *
 * Framework-free (no React, no Next): safe in Server Actions, Route Handlers and the browser.
 */
import { isAuthError } from "@supabase/supabase-js";
import { ZodError } from "zod";
import { isDomainError } from "@/lib/domain/errors";

/** Codes raised by the database (`raise exception … message = '<CODE>'`) or returned by RPCs. */
export const DB_ERROR_CODES = [
  "UNAUTHENTICATED",
  "FORBIDDEN",
  "NOT_FOUND",
  "VALIDATION",
  "STALE_VERSION",
  // Company and members
  "ALREADY_IN_COMPANY",
  "COMPANY_NAME_TAKEN",
  "NO_WORKING_DAYS",
  "ROLE_NOT_ALLOWED",
  "ALREADY_MEMBER",
  "CANNOT_REMOVE_OWNER",
  "CANNOT_CHANGE_OWNER_ROLE",
  // Invitations
  "CANNOT_INVITE_SELF",
  "INVITEE_IN_OTHER_COMPANY",
  "INVITE_EMAIL_MISMATCH",
  "INVITE_EXPIRED",
  "INVITE_NOT_PENDING",
  // Invite codes (the last four are returned in `redeem_invite_code().error_code`)
  "RATE_LIMITED",
  "INVALID_CODE",
  "CODE_EXPIRED",
  "CODE_REVOKED",
  "CODE_EXHAUSTED",
  // Projects
  "INVALID_DATES",
  "INVALID_BUDGET",
  "PROJECT_NAME_TAKEN",
  "INVALID_TRANSITION",
  "REASON_REQUIRED",
  "PROJECT_HAS_INCOMPLETE_ACTIVITIES",
  "NOT_CLOSED",
  "RESTORE_EXPIRED",
  // WBS
  "PARENT_NOT_FOUND",
  "PARENT_DELETED",
  "MAX_DEPTH_EXCEEDED",
  "INVALID_MOVE",
  // Activity log
  "LOG_IMMUTABLE",
] as const;

/** Codes produced by the app itself (auth flows, network, unknown failures). */
export const CLIENT_ERROR_CODES = [
  "NETWORK",
  "UNEXPECTED",
  "EMAIL_NOT_CONFIRMED",
  "INVALID_CREDENTIALS",
  "EMAIL_TAKEN",
  "WEAK_PASSWORD",
  "OAUTH_FAILED",
  "OAUTH_NOT_CONFIGURED",
  "LINK_INVALID",
  "LINK_EXPIRED",
  "EMAIL_SEND_FAILED",
] as const;

export type DbErrorCode = (typeof DB_ERROR_CODES)[number];
export type ClientErrorCode = (typeof CLIENT_ERROR_CODES)[number];
export type ErrorCode = DbErrorCode | ClientErrorCode;

export const ERROR_CODES: readonly ErrorCode[] = [...DB_ERROR_CODES, ...CLIENT_ERROR_CODES];

const ERROR_CODE_SET: ReadonlySet<string> = new Set(ERROR_CODES);
const DB_ERROR_CODE_SET: ReadonlySet<string> = new Set(DB_ERROR_CODES);

export function isErrorCode(value: unknown): value is ErrorCode {
  return typeof value === "string" && ERROR_CODE_SET.has(value);
}

/** Fallback messages: what happened and how to fix it. RPC `detail` text wins when present. */
export const DEFAULT_MESSAGES: Record<ErrorCode, string> = {
  UNAUTHENTICATED: "Your session has ended. Sign in again to continue.",
  FORBIDDEN: "You don't have permission to do that. Ask a project PM or the Owner PM for access.",
  NOT_FOUND: "We couldn't find that. It may have been deleted, or you may no longer have access.",
  VALIDATION: "Some details need fixing. Check the highlighted fields and try again.",
  STALE_VERSION: "Someone else changed this just now. Reload to see their changes, or keep yours.",
  ALREADY_IN_COMPANY: "You already belong to a company. An account can belong to one company only.",
  COMPANY_NAME_TAKEN: "A company with this name already exists. Ask its Owner PM to invite you.",
  NO_WORKING_DAYS: "Pick at least one working day.",
  ROLE_NOT_ALLOWED: "Only company PMs can be project PMs. Ask the Owner PM to change their role first.",
  ALREADY_MEMBER: "This person is already on the project.",
  CANNOT_REMOVE_OWNER: "The Owner PM can't be removed.",
  CANNOT_CHANGE_OWNER_ROLE: "The Owner PM's role can't be changed.",
  CANNOT_INVITE_SELF: "That's your own email. Enter the email of the person you want to invite.",
  INVITEE_IN_OTHER_COMPANY: "This person already belongs to another company.",
  INVITE_EMAIL_MISMATCH:
    "This invitation was sent to a different email address. Sign in with that email to accept it.",
  INVITE_EXPIRED: "This invitation has expired. Ask the project PM to send a new one.",
  INVITE_NOT_PENDING: "This invitation was already used or cancelled.",
  RATE_LIMITED: "Too many attempts. Wait a few minutes, then try again.",
  INVALID_CODE: "This code is not valid. Codes look like ABCD-2345.",
  CODE_EXPIRED: "This code has expired. Ask your PM for a new one.",
  CODE_REVOKED: "This code was turned off. Ask your PM for a new one.",
  CODE_EXHAUSTED: "This code has reached its usage limit. Ask your PM for a new one.",
  INVALID_DATES: "The end date must be on or after the start date.",
  INVALID_BUDGET: "Enter a budget greater than ₱0.00 with at most 2 decimal places.",
  PROJECT_NAME_TAKEN: "Your company already has a project with this name. Choose a different name.",
  INVALID_TRANSITION: "The project can't move to that status from its current one.",
  REASON_REQUIRED: "Add a reason for this change.",
  PROJECT_HAS_INCOMPLETE_ACTIVITIES: "Complete every activity before completing the project.",
  NOT_CLOSED: "Only completed or cancelled projects can be archived.",
  RESTORE_EXPIRED: "This was deleted more than 30 days ago and can't be restored.",
  PARENT_NOT_FOUND: "The parent activity was deleted or moved. Reload and try again.",
  PARENT_DELETED: "Its parent is in the trash. Restore the parent first.",
  MAX_DEPTH_EXCEEDED:
    "The WBS has 3 levels: Deliverable → Sub-deliverable → Work package. Choose a higher level.",
  INVALID_MOVE: "An activity can't move under itself or one of its own sub-items.",
  LOG_IMMUTABLE: "Activity log entries can't be changed or deleted.",
  NETWORK: "We couldn't reach the server. Check your internet connection and try again.",
  UNEXPECTED: "Something went wrong on our side. Try again in a moment.",
  EMAIL_NOT_CONFIRMED: "Confirm your email first: open the link we sent you, or request a new one.",
  INVALID_CREDENTIALS:
    "That email and password don't match. Check them and try again, or reset your password.",
  EMAIL_TAKEN: "An account with this email already exists. Sign in instead, or reset your password.",
  WEAK_PASSWORD: "Choose a stronger password: at least 10 characters that are hard to guess.",
  OAUTH_FAILED: "Google sign-in didn't finish. Try again, or use your email and password.",
  OAUTH_NOT_CONFIGURED: "Google sign-in isn't set up yet. Use your email and password for now.",
  LINK_INVALID: "This link is invalid or was already used. Request a new one.",
  LINK_EXPIRED: "This link has expired. Request a new one.",
  EMAIL_SEND_FAILED: "We couldn't send the email just now. Wait a minute, then try again.",
};

export function errorMessage(code: ErrorCode): string {
  return DEFAULT_MESSAGES[code];
}

export interface AppError {
  code: ErrorCode;
  /** Safe to show to the user. */
  message: string;
  /** Form field the error belongs to (RPC `hint`), when known. */
  field?: string;
  /** Present for UNEXPECTED errors; the same id is in the server log. */
  referenceId?: string;
}

/**
 * Throw this from server code (inside `runAction`, queries, route handlers) to fail with a known
 * code instead of returning early: `throw new AppException("NOT_FOUND")`.
 */
export class AppException extends Error {
  readonly code: ErrorCode;
  readonly field?: string;
  readonly fieldErrors?: Record<string, string>;

  constructor(
    code: ErrorCode,
    message?: string,
    options: { field?: string; fieldErrors?: Record<string, string>; cause?: unknown } = {},
  ) {
    super(message ?? DEFAULT_MESSAGES[code], options.cause === undefined ? undefined : { cause: options.cause });
    this.name = "AppException";
    this.code = code;
    if (options.field) this.field = options.field;
    if (options.fieldErrors) this.fieldErrors = options.fieldErrors;
  }
}

/** `{ [field]: message }` for an AppError tied to a field, else undefined. */
export function appErrorFieldErrors(error: AppError): Record<string, string> | undefined {
  return error.field ? { [error.field]: error.message } : undefined;
}

// ---------------------------------------------------------------------------
// Auth redirect errors (`/login?error=<param>`)
// ---------------------------------------------------------------------------

/** Codes the auth route handlers put in `/login?error=…` (as lower-case params). */
export const AUTH_REDIRECT_ERROR_CODES = [
  "LINK_INVALID",
  "LINK_EXPIRED",
  "OAUTH_FAILED",
  "OAUTH_NOT_CONFIGURED",
  "EMAIL_NOT_CONFIRMED",
  "UNAUTHENTICATED",
  "UNEXPECTED",
] as const satisfies readonly ErrorCode[];

export type AuthRedirectErrorCode = (typeof AUTH_REDIRECT_ERROR_CODES)[number];

/** `LINK_INVALID` → `link_invalid` (the value used in `/login?error=`). */
export function authRedirectParam(code: AuthRedirectErrorCode): string {
  return code.toLowerCase();
}

/**
 * Picks the `/login?error=` code for a failed auth step. Specific codes (expired link, OAuth,
 * unconfirmed email, …) are kept; anything else, including UNEXPECTED, uses `fallback`.
 */
export function authRedirectCodeFor(error: AppError, fallback: AuthRedirectErrorCode): AuthRedirectErrorCode {
  if (error.code === "UNEXPECTED") return fallback;
  return AUTH_REDIRECT_ERROR_CODES.find((code) => code === error.code) ?? fallback;
}

/**
 * Reads `/login?error=<param>` back into a friendly message for the login page. Unknown values
 * return null (never echo the raw parameter).
 */
export function authRedirectError(
  param: string | null | undefined,
): { code: AuthRedirectErrorCode; message: string } | null {
  if (!param) return null;
  const code = param.trim().toUpperCase();
  const match = AUTH_REDIRECT_ERROR_CODES.find((candidate) => candidate === code);
  return match ? { code: match, message: DEFAULT_MESSAGES[match] } : null;
}

// ---------------------------------------------------------------------------
// toAppError
// ---------------------------------------------------------------------------

interface PostgrestLikeError {
  code: string;
  message: string;
  details?: string | null;
  hint?: string | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isPostgrestLike(value: unknown): value is PostgrestLikeError {
  return (
    isRecord(value) &&
    typeof value.code === "string" &&
    typeof value.message === "string" &&
    ("details" in value || "hint" in value)
  );
}

const NETWORK_MESSAGE = /fetch failed|failed to fetch|networkerror|network request failed|load failed|econnrefused|econnreset|enotfound|etimedout|socket hang up/i;

function isNetworkError(value: unknown): boolean {
  if (!isRecord(value)) return false;
  const name = typeof value.name === "string" ? value.name : "";
  const message = typeof value.message === "string" ? value.message : "";
  if (name === "AbortError" || name === "TimeoutError") return true;
  if (name === "AuthRetryableFetchError") return true;
  return (name === "TypeError" || name === "FetchError" || name === "Error" || name === "") && NETWORK_MESSAGE.test(message);
}

function trimmed(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const t = value.trim();
  return t === "" ? undefined : t;
}

function known(code: ErrorCode, message?: string, field?: string): AppError {
  const error: AppError = { code, message: message ?? DEFAULT_MESSAGES[code] };
  if (field) error.field = field;
  return error;
}

function newReferenceId(): string {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === "function") return c.randomUUID();
  return `${Date.now().toString(16)}-${Math.random().toString(16).slice(2, 10)}`;
}

/** Logs the original error with a reference id and returns a message without raw details. */
export function unexpectedError(original: unknown): AppError {
  const referenceId = newReferenceId();
  const shortRef = referenceId.slice(0, 8).toUpperCase();
  console.error(`[UNEXPECTED ${referenceId}]`, original);
  return {
    code: "UNEXPECTED",
    message: `${DEFAULT_MESSAGES.UNEXPECTED} If it keeps happening, contact support and mention reference ${shortRef}.`,
    referenceId,
  };
}

function fromPostgrest(error: PostgrestLikeError): AppError | null {
  const code = error.code.trim();
  if (code === "P0001") {
    const dbCode = error.message.trim();
    if (DB_ERROR_CODE_SET.has(dbCode)) {
      return known(dbCode as DbErrorCode, trimmed(error.details), trimmed(error.hint));
    }
    return null;
  }
  switch (code) {
    case "42501": // insufficient_privilege (e.g. a direct table write)
      return known("FORBIDDEN");
    // An invalid or expired JWT is a session problem, not a role problem: "sign in again" is the
    // message that helps (FORBIDDEN would tell the user to ask a PM for access).
    case "PGRST301": // JWT could not be decoded / invalid
    case "PGRST302": // anonymous access disabled
    case "PGRST303": // JWT expired
      return known("UNAUTHENTICATED");
    case "PGRST116": // .single() found no row
      return known("NOT_FOUND");
    case "23514": // check_violation (direct profiles update)
    case "22P02": // invalid_text_representation (bad uuid / enum)
    case "22007": // invalid_datetime_format
    case "22008": // datetime_field_overflow
      return known("VALIDATION");
    case "":
      return isNetworkError({ name: "TypeError", message: error.message }) ? known("NETWORK") : null;
    default:
      return null;
  }
}

const AUTH_CODE_MAP: Record<string, { code: ErrorCode; message?: string; field?: string }> = {
  invalid_credentials: { code: "INVALID_CREDENTIALS" },
  email_not_confirmed: { code: "EMAIL_NOT_CONFIRMED" },
  provider_email_needs_verification: { code: "EMAIL_NOT_CONFIRMED" },
  user_already_exists: { code: "EMAIL_TAKEN", field: "email" },
  email_exists: { code: "EMAIL_TAKEN", field: "email" },
  identity_already_exists: {
    code: "EMAIL_TAKEN",
    message: "This Google account is already linked to another CivPMS account.",
  },
  weak_password: { code: "WEAK_PASSWORD", field: "password" },
  same_password: {
    code: "VALIDATION",
    message: "Your new password must be different from your current one.",
    field: "password",
  },
  over_email_send_rate_limit: {
    code: "RATE_LIMITED",
    message: "Too many emails were sent to this address. Wait a few minutes, then try again.",
  },
  over_request_rate_limit: { code: "RATE_LIMITED" },
  over_sms_send_rate_limit: { code: "RATE_LIMITED" },
  otp_expired: { code: "LINK_EXPIRED" },
  bad_code_verifier: {
    code: "LINK_INVALID",
    message: "Open the link in the same browser you used to request it, or request a new one.",
  },
  invite_not_found: { code: "LINK_INVALID" },
  flow_state_not_found: { code: "OAUTH_FAILED" },
  flow_state_expired: { code: "OAUTH_FAILED" },
  bad_oauth_state: { code: "OAUTH_FAILED" },
  bad_oauth_callback: { code: "OAUTH_FAILED" },
  oauth_provider_not_supported: { code: "OAUTH_FAILED" },
  session_not_found: { code: "UNAUTHENTICATED" },
  session_expired: { code: "UNAUTHENTICATED" },
  refresh_token_not_found: { code: "UNAUTHENTICATED" },
  refresh_token_already_used: { code: "UNAUTHENTICATED" },
  no_authorization: { code: "UNAUTHENTICATED" },
  bad_jwt: { code: "UNAUTHENTICATED" },
  reauthentication_needed: { code: "UNAUTHENTICATED", message: "Sign in again to confirm it's you." },
  user_banned: { code: "FORBIDDEN", message: "This account is suspended. Contact your Owner PM or support." },
  signup_disabled: { code: "FORBIDDEN", message: "New sign-ups are turned off right now. Try again later." },
  email_provider_disabled: {
    code: "FORBIDDEN",
    message: "Email sign-in is turned off right now. Use Google sign-in instead.",
  },
  email_address_invalid: { code: "VALIDATION", message: "Enter a valid email address.", field: "email" },
  // Supabase's built-in mailer only emails the project's team members (no custom SMTP yet).
  email_address_not_authorized: {
    code: "EMAIL_SEND_FAILED",
    message: "We can't send email to this address yet. Use a different email or contact support.",
    field: "email",
  },
  validation_failed: { code: "VALIDATION" },
  captcha_failed: { code: "VALIDATION", message: "The security check failed. Try again." },
  request_timeout: { code: "NETWORK" },
};

/** Auth `validation_failed` for a provider that is switched off in the Supabase dashboard. */
const PROVIDER_DISABLED_MESSAGE = /provider is not enabled|unsupported provider/i;
/** Auth `unexpected_failure` when the mailer (SMTP) fails: "Error sending confirmation email". */
const EMAIL_SEND_MESSAGE = /error sending .*(email|mail)|smtp|mail(er)? .*fail/i;

/** True for an OAuth error description that means "this provider is not configured". */
export function isProviderDisabledMessage(message: string | null | undefined): boolean {
  return typeof message === "string" && PROVIDER_DISABLED_MESSAGE.test(message);
}

/** Older Auth servers omit `code`; their messages are stable enough to match. */
const AUTH_MESSAGE_MAP: [RegExp, string][] = [
  [/invalid login credentials/i, "invalid_credentials"],
  [/email not confirmed/i, "email_not_confirmed"],
  [/user already registered/i, "user_already_exists"],
  [/email link is invalid or has expired|token has expired/i, "otp_expired"],
];

function fromAuthError(error: {
  code?: string;
  status?: number;
  name?: string;
  message: string;
  reasons?: unknown;
}): AppError | null {
  if (error.name === "AuthRetryableFetchError") return known("NETWORK");
  if (error.name === "AuthSessionMissingError") return known("UNAUTHENTICATED");
  if (error.name === "AuthPKCECodeVerifierMissingError") {
    return known("LINK_INVALID", AUTH_CODE_MAP.bad_code_verifier.message);
  }

  if (error.code === "validation_failed" && PROVIDER_DISABLED_MESSAGE.test(error.message)) {
    return known("OAUTH_NOT_CONFIGURED");
  }
  if (error.code === "provider_disabled") return known("OAUTH_NOT_CONFIGURED");
  if ((error.code === "unexpected_failure" || !error.code) && EMAIL_SEND_MESSAGE.test(error.message)) {
    return known("EMAIL_SEND_FAILED");
  }

  let key = error.code;
  if (!key) key = AUTH_MESSAGE_MAP.find(([pattern]) => pattern.test(error.message))?.[1];
  const mapped = key ? AUTH_CODE_MAP[key] : undefined;
  if (mapped) {
    if (mapped.code === "WEAK_PASSWORD" && Array.isArray(error.reasons) && error.reasons.includes("pwned")) {
      return known(
        "WEAK_PASSWORD",
        "This password has appeared in a data breach. Choose a different one.",
        "password",
      );
    }
    return known(mapped.code, mapped.message, mapped.field);
  }
  if (error.status === 429) return known("RATE_LIMITED");
  return null;
}

/**
 * Normalises any error into an `AppError`. Never returns raw database/provider text, except the
 * human `detail` our own RPCs raise with `P0001`.
 */
export function toAppError(err: unknown): AppError {
  if (err instanceof AppException) {
    const error: AppError = { code: err.code, message: err.message };
    if (err.field) error.field = err.field;
    return error;
  }

  if (isAuthError(err)) {
    return fromAuthError(err) ?? unexpectedError(err);
  }

  if (err instanceof ZodError) {
    const issue = err.issues[0];
    const field = issue && issue.path.length > 0 ? issue.path.map(String).join(".") : undefined;
    return known("VALIDATION", issue?.message ?? DEFAULT_MESSAGES.VALIDATION, field);
  }

  if (isDomainError(err)) {
    return err.code === "NO_WORKING_DAYS" ? known("NO_WORKING_DAYS") : known("VALIDATION");
  }

  if (isPostgrestLike(err)) {
    return fromPostgrest(err) ?? unexpectedError(err);
  }

  if (isNetworkError(err)) {
    return known("NETWORK");
  }

  return unexpectedError(err);
}

// ---------------------------------------------------------------------------
// RPCs that return failures instead of raising
// ---------------------------------------------------------------------------

/**
 * Shape of RPCs that report expected failures in their result (so the database keeps the failed
 * attempt, e.g. for rate limiting) instead of raising: `redeem_invite_code` returns
 * `{ ok: false, error_code: 'INVALID_CODE' | 'CODE_EXPIRED' | …, error_message }`.
 */
export interface RpcResultLike {
  ok?: unknown;
  error_code?: unknown;
  error_message?: unknown;
}

/**
 * `null` when the RPC result reports success; otherwise the `AppError` for its `error_code`, with
 * the database's plain-language `error_message` (or the default message). An unknown code, or a
 * result that is not an object, becomes UNEXPECTED (logged with a reference id).
 *
 * ```ts
 * const { data, error } = await supabase.rpc("redeem_invite_code", { p_code });
 * if (error) return failFrom(error);
 * const failure = errorFromRpcResult(data, { field: "code" });
 * if (failure) return failWith(failure);
 * ```
 */
export function errorFromRpcResult(result: unknown, options: { field?: string } = {}): AppError | null {
  if (!isRecord(result)) return unexpectedError(new Error(`RPC result is not an object: ${typeof result}`));
  const { ok, error_code: code, error_message: message } = result as RpcResultLike;
  if (ok === true) return null;
  if (!isErrorCode(code)) {
    return unexpectedError(new Error(`RPC result has an unknown error_code: ${String(code)}`));
  }
  return known(code, trimmed(message), options.field);
}
