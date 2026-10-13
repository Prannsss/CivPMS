/**
 * OAuth (Google) and PKCE code exchange: `/auth/callback?code=…&next=/path`.
 *
 * Success → the sanitized `next`, else /onboarding (which sends onboarded users home).
 * Failure → /login?error=<code> (oauth_failed, oauth_not_configured, link_expired, link_invalid);
 * the login page turns it into a message with `authRedirectError()`. Raw provider text is never
 * forwarded.
 */
import { NextResponse, type NextRequest } from "next/server";
import { ONBOARDING_PATH, loginErrorPath } from "@/lib/auth-routes";
import {
  authRedirectCodeFor,
  authRedirectParam,
  isProviderDisabledMessage,
  toAppError,
  type AuthRedirectErrorCode,
} from "@/lib/errors";
import { safeNextPath } from "@/lib/safe-next-path";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

function redirectToLogin(request: NextRequest, code: AuthRedirectErrorCode): NextResponse {
  return NextResponse.redirect(new URL(loginErrorPath(authRedirectParam(code)), request.url));
}

/** Maps `?error=…&error_code=…&error_description=…` sent back by Supabase or the provider. */
function providerErrorCode(searchParams: URLSearchParams): AuthRedirectErrorCode | null {
  const errorCode = searchParams.get("error_code");
  const error = searchParams.get("error");
  if (!errorCode && !error) return null;
  if (errorCode === "otp_expired") return "LINK_EXPIRED";
  if (errorCode === "provider_disabled" || isProviderDisabledMessage(searchParams.get("error_description"))) {
    return "OAUTH_NOT_CONFIGURED";
  }
  return "OAUTH_FAILED";
}

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;

  // The provider or Supabase sent us back with an error (e.g. the consent screen was cancelled,
  // the provider is switched off, or an email link expired before it was opened).
  const providerError = providerErrorCode(searchParams);
  if (providerError) {
    return redirectToLogin(request, providerError);
  }

  const code = searchParams.get("code");
  if (!code) {
    return redirectToLogin(request, "LINK_INVALID");
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) {
    return redirectToLogin(request, authRedirectCodeFor(toAppError(error), "OAUTH_FAILED"));
  }

  const next = safeNextPath(searchParams.get("next"), ONBOARDING_PATH);
  return NextResponse.redirect(new URL(next, request.url));
}
