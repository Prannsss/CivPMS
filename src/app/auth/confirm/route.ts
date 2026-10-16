/**
 * Email links (token-hash flow): `/auth/confirm?token_hash=…&type=…&next=/path`.
 * The Supabase email templates in supabase/templates point here.
 *
 * - recovery → /reset-password (the user now has a short recovery session)
 * - signup / email / magiclink / invite / email_change → the sanitized `next`, else /onboarding
 * - missing, invalid, used or expired links → /login?error=link_invalid | link_expired
 */
import type { EmailOtpType } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";
import { ONBOARDING_PATH, RESET_PASSWORD_PATH, loginErrorPath } from "@/lib/auth-routes";
import {
  authRedirectCodeFor,
  authRedirectParam,
  toAppError,
  type AuthRedirectErrorCode,
} from "@/lib/errors";
import { safeNextPath } from "@/lib/safe-next-path";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const EMAIL_OTP_TYPES: readonly EmailOtpType[] = [
  "signup",
  "invite",
  "magiclink",
  "recovery",
  "email_change",
  "email",
];

function isEmailOtpType(value: string | null): value is EmailOtpType {
  return value !== null && (EMAIL_OTP_TYPES as readonly string[]).includes(value);
}

function redirectToLogin(request: NextRequest, code: AuthRedirectErrorCode): NextResponse {
  return NextResponse.redirect(new URL(loginErrorPath(authRedirectParam(code)), request.url));
}

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type");

  if (!tokenHash || !isEmailOtpType(type)) {
    return redirectToLogin(request, "LINK_INVALID");
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
  if (error) {
    return redirectToLogin(request, authRedirectCodeFor(toAppError(error), "LINK_INVALID"));
  }

  const destination =
    type === "recovery" ? RESET_PASSWORD_PATH : safeNextPath(searchParams.get("next"), ONBOARDING_PATH);
  return NextResponse.redirect(new URL(destination, request.url));
}
