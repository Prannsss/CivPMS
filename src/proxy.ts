/**
 * Route protection (Next 16 "proxy", formerly middleware). Runs on the Node runtime.
 *
 * 1. Refreshes the Supabase session on every matched request (cookies written to the response).
 * 2. Signed-in visitors on /login or /signup go to a safe `next` or home.
 * 3. Visitors without a session may only reach public paths (see src/lib/auth-routes.ts);
 *    other pages redirect to /login?next=<path+search>, other API routes answer 401.
 *
 * This is a UX gate, not the security boundary: RLS and the RPCs enforce access (CLAUDE.md rule 4),
 * and server code re-checks the session (src/server/context.ts).
 */
import { NextResponse, type NextRequest } from "next/server";
import {
  HOME_PATH,
  isApiPath,
  isAuthPage,
  isCronPath,
  isPublicPath,
  isStaticAssetPath,
  loginRedirectPath,
} from "@/lib/auth-routes";
import { safeNextPath } from "@/lib/safe-next-path";
import { updateSession, withSessionCookies } from "@/lib/supabase/proxy";

export async function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;

  // Cron jobs authenticate with a bearer secret; static files need no session.
  if (isCronPath(pathname) || isStaticAssetPath(pathname)) {
    return NextResponse.next();
  }

  const { response, userId } = await updateSession(request);

  if (userId) {
    if (isAuthPage(pathname)) {
      const target = safeNextPath(request.nextUrl.searchParams.get("next"), HOME_PATH);
      return withSessionCookies(NextResponse.redirect(new URL(target, request.url)), response);
    }
    return response;
  }

  if (isPublicPath(pathname, { isProduction: process.env.NODE_ENV === "production" })) {
    return response;
  }

  // A Server Action posted after the session expired: let it run. The database rejects it
  // (UNAUTHENTICATED → ActionResult), and re-rendering the page redirects to /login.
  if (request.method === "POST" && request.headers.has("next-action")) {
    return response;
  }

  if (isApiPath(pathname)) {
    return withSessionCookies(
      NextResponse.json(
        { ok: false, error: { code: "UNAUTHENTICATED", message: "Please sign in to continue." } },
        { status: 401 },
      ),
      response,
    );
  }

  const loginUrl = new URL(loginRedirectPath(pathname, search), request.url);
  return withSessionCookies(NextResponse.redirect(loginUrl), response);
}

export const config = {
  matcher: [
    /*
     * Everything except Next internals, the icons/brand folders, root icon files and images.
     * Keep in sync with isStaticAssetPath() in src/lib/auth-routes.ts.
     */
    "/((?!_next/static|_next/image|favicon\\.ico|icon\\.png|apple-icon\\.png|robots\\.txt|sitemap\\.xml|manifest\\.webmanifest|brand/|icons/|.*\\.(?:svg|png|jpg|jpeg|gif|webp|avif|ico|bmp)$).*)",
  ],
};
