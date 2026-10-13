import "server-only";

/**
 * Public Supabase Auth settings (`GET /auth/v1/settings`): which sign-in methods are switched on.
 *
 * Why: when Google is turned off in the dashboard, Supabase answers the OAuth start with a raw JSON
 * error page that the app never sees. The login and signup pages call `getAuthProviders()` and
 * disable the Google button with the OAUTH_NOT_CONFIGURED message instead.
 *
 * Cached for 5 minutes (Next data cache). Never throws: returns `null` when Supabase can't be
 * reached, in which case the UI should keep Google available (the callback still maps failures).
 */
import { publicEnv } from "@/lib/env";

export interface AuthProviders {
  google: boolean;
  email: boolean;
  /** New sign-ups are turned off (Authentication → Sign In / Providers → "Allow new users to sign up"). */
  signupDisabled: boolean;
  /** Email confirmation is off: sign-up returns a session immediately. */
  mailerAutoconfirm: boolean;
}

export const AUTH_SETTINGS_REVALIDATE_SECONDS = 300;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Parses the `/auth/v1/settings` JSON; exported for tests. */
export function parseAuthSettings(body: unknown): AuthProviders | null {
  if (!isRecord(body) || !isRecord(body.external)) return null;
  return {
    google: body.external.google === true,
    email: body.external.email === true,
    signupDisabled: body.disable_signup === true,
    mailerAutoconfirm: body.mailer_autoconfirm === true,
  };
}

export async function getAuthProviders(options: { fetch?: typeof fetch } = {}): Promise<AuthProviders | null> {
  const doFetch = options.fetch ?? globalThis.fetch;
  try {
    const response = await doFetch(`${publicEnv.supabaseUrl}/auth/v1/settings`, {
      headers: { apikey: publicEnv.supabasePublishableKey, accept: "application/json" },
      signal: AbortSignal.timeout(5_000),
      next: { revalidate: AUTH_SETTINGS_REVALIDATE_SECONDS },
    });
    if (!response.ok) {
      console.warn(`[auth-settings] Supabase answered ${response.status}`);
      return null;
    }
    return parseAuthSettings(await response.json());
  } catch (error) {
    console.warn("[auth-settings] could not read the Supabase Auth settings", error instanceof Error ? error.name : error);
    return null;
  }
}
