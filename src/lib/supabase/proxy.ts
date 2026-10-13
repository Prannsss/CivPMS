/**
 * Session refresh for `src/proxy.ts` (Next 16's replacement for middleware).
 *
 * `updateSession()` validates the session cookie (refreshing the access token when it expired),
 * writes any updated cookies to both the forwarded request and the response, and reports the
 * signed-in user id. Every response the proxy returns must carry those cookies; use
 * `withSessionCookies()` when returning a redirect instead of `response`.
 */
import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { publicEnv } from "@/lib/env";
import type { Database } from "./database.types";

export interface SessionUpdate {
  /** `NextResponse.next()` carrying refreshed auth cookies (return it, or copy its cookies). */
  response: NextResponse;
  /** The signed-in user's id, or `null` when there is no valid session. */
  userId: string | null;
}

/** Headers @supabase/ssr asks for whenever it sets auth cookies (no CDN caching of sessions). */
const SESSION_HEADER_NAMES = ["cache-control", "expires", "pragma"] as const;

export async function updateSession(request: NextRequest): Promise<SessionUpdate> {
  let response = NextResponse.next({ request });

  const supabase = createServerClient<Database>(publicEnv.supabaseUrl, publicEnv.supabasePublishableKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet, headers) {
        for (const { name, value } of cookiesToSet) {
          request.cookies.set(name, value);
        }
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options);
        }
        for (const [key, value] of Object.entries(headers)) {
          response.headers.set(key, value);
        }
      },
    },
  });

  // Nothing may run between creating the client and getClaims(): it is what refreshes the session.
  let userId: string | null = null;
  try {
    const { data, error } = await supabase.auth.getClaims();
    const sub = data?.claims?.sub;
    if (!error && typeof sub === "string" && sub.length > 0) {
      userId = sub;
    }
  } catch (error) {
    console.error("[proxy] Could not validate the session", error);
  }

  return { response, userId };
}

/**
 * Copies the auth cookies (and their no-cache headers) from the session response onto another
 * response, typically a redirect, so a refreshed or cleared session is never lost.
 */
export function withSessionCookies<T extends NextResponse>(target: T, session: NextResponse): T {
  for (const cookie of session.cookies.getAll()) {
    target.cookies.set(cookie);
  }
  for (const name of SESSION_HEADER_NAMES) {
    const value = session.headers.get(name);
    if (value !== null) target.headers.set(name, value);
  }
  return target;
}
