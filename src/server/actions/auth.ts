"use server";

/**
 * Email + password authentication (spec §4.1, D10): sign in, sign up, confirmation resend,
 * password reset request and new password. Google sign-in starts in the browser (it needs a
 * redirect) and comes back through /auth/callback.
 *
 * Every action returns an ActionResult with a plain-language message; raw Auth text never reaches
 * the page. Where to go next is decided here (`redirectTo`), so the forms only navigate.
 */
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import {
  checkEmailPath,
  emailFlowError,
  isVisibleRecoveryError,
  postAuthDestination,
  cleanNext,
} from "@/components/auth/auth-flow";
import { fail, failWith, fromZodError, ok, runAction, type ActionResult } from "@/lib/action-result";
import { RESET_PASSWORD_PATH } from "@/lib/auth-routes";
import {
  emailSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
  signInSchema,
  signUpSchema,
} from "@/lib/domain/schemas";
import { toAppError } from "@/lib/errors";
import { serverEnv } from "@/lib/env";
import { createClient, type ServerSupabaseClient } from "@/lib/supabase/server";

const nextField = z.string().max(2048).nullish();

export interface AuthRedirect {
  /** Where the page should navigate next. */
  redirectTo: string;
}

/**
 * The origin used in email links and OAuth redirects. In development it follows the request (any
 * port works); deployed, it is APP_URL (or the Vercel URL), never a client-supplied header.
 */
async function appOrigin(): Promise<string> {
  if (process.env.NODE_ENV === "production") return serverEnv().appUrl;
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host");
  if (!host) return serverEnv().appUrl;
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") || host.startsWith("127.") ? "http" : "https");
  return `${proto.split(",")[0].trim()}://${host.split(",")[0].trim()}`;
}

/** `/auth/callback?next=…` on this site: where email links and PKCE flows land. */
async function callbackUrl(next: string): Promise<string> {
  const params = new URLSearchParams({ next });
  return `${await appOrigin()}/auth/callback?${params.toString()}`;
}

async function isOnboarded(supabase: ServerSupabaseClient, userId: string): Promise<boolean> {
  const { data, error } = await supabase.from("profiles").select("onboarded_at").eq("id", userId).maybeSingle();
  if (error) throw error;
  return Boolean(data?.onboarded_at);
}

// ---------------------------------------------------------------------------
// Sign in
// ---------------------------------------------------------------------------

const signInInput = signInSchema.extend({ next: nextField });

export async function signInWithPassword(input: z.input<typeof signInInput>): Promise<ActionResult<AuthRedirect>> {
  return runAction(async () => {
    const parsed = signInInput.safeParse(input);
    if (!parsed.success) return fromZodError(parsed.error);
    const { email, password, next } = parsed.data;

    const supabase = await createClient();
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error || !data.user) {
      const appError = toAppError(error ?? new Error("signInWithPassword returned no user"));
      // Wrong email or password is a form-level error: never say which of the two was wrong.
      return failWith({ code: appError.code, message: appError.message, referenceId: appError.referenceId });
    }

    const onboarded = await isOnboarded(supabase, data.user.id);
    revalidatePath("/", "layout");
    return ok({ redirectTo: postAuthDestination({ onboarded, next }) });
  });
}

// ---------------------------------------------------------------------------
// Sign up
// ---------------------------------------------------------------------------

const signUpInput = signUpSchema.extend({ next: nextField });

export async function signUpWithPassword(input: z.input<typeof signUpInput>): Promise<ActionResult<AuthRedirect>> {
  return runAction(async () => {
    const parsed = signUpInput.safeParse(input);
    if (!parsed.success) return fromZodError(parsed.error);
    const { email, password } = parsed.data;
    const next = cleanNext(parsed.data.next);
    // Invitation links work before onboarding; everything else continues in onboarding.
    const afterConfirm = postAuthDestination({ onboarded: false, next });

    const supabase = await createClient();
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: { emailRedirectTo: await callbackUrl(afterConfirm) },
    });
    if (error) return failWith(emailFlowError(error, "signup"));

    // Email confirmation switched off in the dashboard: the account is ready right away.
    if (data.session) {
      revalidatePath("/", "layout");
      return ok({ redirectTo: afterConfirm });
    }

    // Supabase answers the same way for an address that already has an account (no email is
    // sent then), so the next page covers both cases without revealing which one it was.
    return ok({ redirectTo: checkEmailPath({ email, type: "signup", next }) });
  });
}

const resendInput = z.object({ email: emailSchema, next: nextField });

/** Sends the sign-up confirmation email again. */
export async function resendConfirmation(input: z.input<typeof resendInput>): Promise<ActionResult<{ email: string }>> {
  return runAction(async () => {
    const parsed = resendInput.safeParse(input);
    if (!parsed.success) return fromZodError(parsed.error);
    const { email } = parsed.data;

    const supabase = await createClient();
    const { error } = await supabase.auth.resend({
      type: "signup",
      email,
      options: { emailRedirectTo: await callbackUrl(postAuthDestination({ onboarded: false, next: parsed.data.next })) },
    });
    if (error) return failWith(emailFlowError(error, "resend"));
    return ok({ email });
  });
}

// ---------------------------------------------------------------------------
// Password reset
// ---------------------------------------------------------------------------

/**
 * Emails a reset link. Succeeds for unknown addresses too (Supabase sends nothing then), so the
 * form never reveals who has an account; only delivery problems are reported.
 */
export async function requestPasswordReset(
  input: z.input<typeof forgotPasswordSchema>,
): Promise<ActionResult<AuthRedirect & { email: string }>> {
  return runAction(async () => {
    const parsed = forgotPasswordSchema.safeParse(input);
    if (!parsed.success) return fromZodError(parsed.error);
    const { email } = parsed.data;

    const supabase = await createClient();
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: await callbackUrl(RESET_PASSWORD_PATH),
    });
    if (error) {
      const appError = emailFlowError(error, "recovery");
      if (isVisibleRecoveryError(appError)) return failWith(appError);
      console.warn("[auth] password reset request failed quietly", appError.code);
    }
    return ok({ email, redirectTo: checkEmailPath({ email, type: "recovery" }) });
  });
}

/** Sets a new password for the signed-in user (after opening the reset link). */
export async function updatePassword(input: z.input<typeof resetPasswordSchema>): Promise<ActionResult<AuthRedirect>> {
  return runAction(async () => {
    const parsed = resetPasswordSchema.safeParse(input);
    if (!parsed.success) return fromZodError(parsed.error);

    const supabase = await createClient();
    const { data: userData, error: userError } = await supabase.auth.getUser();
    if (userError || !userData.user) {
      return fail(
        "LINK_EXPIRED",
        "Your reset link has expired or was already used. Request a new one to set your password.",
      );
    }

    const { error } = await supabase.auth.updateUser({ password: parsed.data.password });
    if (error) {
      const appError = toAppError(error);
      // Field errors (weak or unchanged password) belong to the new-password field.
      if (appError.field === "password") return failWith(appError);
      return failWith({ code: appError.code, message: appError.message, referenceId: appError.referenceId });
    }

    const onboarded = await isOnboarded(supabase, userData.user.id);
    revalidatePath("/", "layout");
    return ok({ redirectTo: postAuthDestination({ onboarded }) });
  });
}
