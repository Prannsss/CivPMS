/**
 * Pure helpers for the sign-in, sign-up and password flows (no React, no Supabase client), shared
 * by the auth Server Actions and the auth pages. Unit-tested in auth-flow.test.ts.
 */
import { isAuthError } from "@supabase/supabase-js";
import { toAppError, type AppError } from "@/lib/errors";
import { HOME_PATH, ONBOARDING_PATH } from "@/lib/auth-routes";
import { safeNextPath } from "@/lib/safe-next-path";

export const CHECK_EMAIL_PATH = "/check-email";
export const FORGOT_PASSWORD_PATH = "/forgot-password";
export const SIGNUP_PATH = "/signup";
/** Seconds before "Resend" works again (Supabase allows one email per address per 60 s). */
export const RESEND_COOLDOWN_SECONDS = 60;

/** Invitation landing pages work before onboarding (accepting an invitation finishes it). */
function isInvitePath(path: string): boolean {
  return path.startsWith("/invite/");
}

/** `next` from a query string or form, made safe; `null` when absent or pointing home. */
export function cleanNext(raw: string | null | undefined): string | null {
  const next = safeNextPath(raw, HOME_PATH);
  return next === HOME_PATH ? null : next;
}

/** `/onboarding`, carrying `next` when there is somewhere specific to go afterwards. */
export function onboardingPath(next: string | null): string {
  if (!next || next === ONBOARDING_PATH) return ONBOARDING_PATH;
  return `${ONBOARDING_PATH}?${new URLSearchParams({ next }).toString()}`;
}

/**
 * Where to go right after signing in (or setting a new password): the safe `next`, except that
 * people who haven't finished onboarding go to onboarding first (keeping `next` for afterwards).
 * Invitation links skip onboarding, because accepting the invitation completes it.
 */
export function postAuthDestination(input: { onboarded: boolean; next?: string | null }): string {
  const next = cleanNext(input.next);
  if (input.onboarded) return next ?? HOME_PATH;
  if (next && isInvitePath(next)) return next;
  return onboardingPath(next);
}

/** `/check-email?email=…&type=signup|recovery[&next=…]`. */
export function checkEmailPath(input: { email: string; type: "signup" | "recovery"; next?: string | null }): string {
  const params = new URLSearchParams({ email: input.email, type: input.type });
  const next = cleanNext(input.next);
  if (next) params.set("next", next);
  return `${CHECK_EMAIL_PATH}?${params.toString()}`;
}

/** `/login`, `/signup` or `/forgot-password` with `next` (and an email to prefill). */
export function authPagePath(base: string, input: { next?: string | null; email?: string | null } = {}): string {
  const params = new URLSearchParams();
  if (input.email) params.set("email", input.email);
  const next = cleanNext(input.next);
  if (next) params.set("next", next);
  const query = params.toString();
  return query ? `${base}?${query}` : base;
}

export type EmailPurpose = "signup" | "resend" | "recovery";

const SEND_FAILED: Record<EmailPurpose, string> = {
  signup:
    "We couldn't send your confirmation email just now, so your account wasn't created. Wait a few minutes, then try again.",
  resend: "We couldn't send another email just now. Wait a few minutes, then try again.",
  recovery: "We couldn't send the reset email just now. Wait a few minutes, then try again.",
};

/**
 * Turns an Auth error from a flow that sends email into an AppError. Mail problems become
 * EMAIL_SEND_FAILED with a message for that flow:
 * - `over_email_send_rate_limit`: Supabase's mailer hit its hourly cap (project-wide without
 *   custom SMTP, so it is not the visitor's fault).
 * - `email_address_not_authorized`: no custom SMTP yet, so only team addresses get mail.
 * - SMTP failures ("Error sending confirmation email").
 * `email_address_invalid` (also used for domains that can't receive mail) gets a clearer message.
 */
export function emailFlowError(error: unknown, purpose: EmailPurpose): AppError {
  if (isAuthError(error) && error.code === "over_email_send_rate_limit") {
    return { code: "EMAIL_SEND_FAILED", message: SEND_FAILED[purpose] };
  }
  const appError = toAppError(error);
  if (appError.code === "EMAIL_SEND_FAILED") {
    const notAuthorized = isAuthError(error) && error.code === "email_address_not_authorized";
    if (!notAuthorized) return { code: "EMAIL_SEND_FAILED", message: SEND_FAILED[purpose] };
    return {
      code: "EMAIL_SEND_FAILED",
      message:
        "We can't send email to this address yet because email delivery is still being set up. Try again later, or contact your CivPMS administrator.",
      field: "email",
    };
  }
  if (isAuthError(error) && error.code === "email_address_invalid") {
    return {
      code: "VALIDATION",
      message: "This email address can't receive mail. Check it for typos, or use a different address.",
      field: "email",
    };
  }
  return appError;
}

/** Errors worth showing on "Forgot password" (others are hidden so the form never reveals accounts). */
export function isVisibleRecoveryError(error: AppError): boolean {
  return (
    error.code === "EMAIL_SEND_FAILED" ||
    error.code === "RATE_LIMITED" ||
    error.code === "NETWORK" ||
    (error.code === "VALIDATION" && error.field === "email")
  );
}

/** The first value of a search param (`?a=1&a=2` → "1"). */
export function firstParam(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

/** A plausible email from a query string, for prefilling forms (never trusted beyond that). */
export function emailParam(value: string | string[] | undefined): string {
  const raw = firstParam(value)?.trim() ?? "";
  return raw.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(raw) ? raw.toLowerCase() : "";
}


/**
 * Masks an email the way the database does for invitation previews (`private.mask_email`):
 * "juan@gmail.com" → "j***@gmail.com". Used to tell whether the signed-in account is probably the
 * invited one; the accept RPC still makes the final check (INVITE_EMAIL_MISMATCH).
 */
export function maskEmail(email: string | null | undefined): string | null {
  if (!email || !email.includes("@")) return null;
  const [local, domain = ""] = email.trim().toLowerCase().split("@");
  return `${local.slice(0, 1)}***@${domain}`;
}

/** True when `email` masks to `hint` (case-insensitive). */
export function matchesEmailHint(email: string | null | undefined, hint: string | null | undefined): boolean {
  const masked = maskEmail(email);
  return Boolean(masked && hint && masked === hint.trim().toLowerCase());
}
