/**
 * Sign out: POST only (a GET link could be triggered by prefetching or a third-party page), and
 * only from our own pages (a cross-site form post is refused). Ends this browser's session and
 * answers 303 → /login.
 *
 * Usage from any page: `<form action="/auth/signout" method="post"><button>Log out</button></form>`.
 */
import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import { LOGIN_PATH } from "@/lib/auth-routes";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/**
 * Browsers send `Origin` on every POST. When present it must match the host the request was sent
 * to (or the forwarded host behind a proxy). Requests without it (curl, very old browsers) are
 * allowed: they can only sign out the session whose cookies they carry.
 */
function isSameOriginPost(request: NextRequest): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return true;
  let originHost: string;
  try {
    originHost = new URL(origin).host;
  } catch {
    return false;
  }
  const hosts = [request.headers.get("x-forwarded-host"), request.headers.get("host"), request.nextUrl.host];
  return hosts.some((host) => typeof host === "string" && host.split(",")[0].trim() === originHost);
}

export async function POST(request: NextRequest) {
  if (!isSameOriginPost(request)) {
    return NextResponse.json(
      { ok: false, error: { code: "FORBIDDEN", message: "Sign out from CivPMS itself." } },
      { status: 403 },
    );
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signOut({ scope: "local" });

  if (error) {
    // Make sure the browser forgets the session even if Supabase could not be reached.
    console.warn("[auth/signout] signOut returned an error; clearing auth cookies", error.code ?? error.name);
    const cookieStore = await cookies();
    for (const { name } of cookieStore.getAll()) {
      if (name.startsWith("sb-") && name.includes("-auth-token")) cookieStore.delete(name);
    }
  }

  revalidatePath("/", "layout");
  return NextResponse.redirect(new URL(LOGIN_PATH, request.url), { status: 303 });
}
