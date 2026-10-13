/**
 * Sign-in for e2e tests without the login page UI.
 *
 *   await loginAs(context, "owner");               // seeded demo account (supabase/seed/demo.sql)
 *   await loginAs(context, "foundInspector");      // e2e account (supabase/seed/found-e2e.sql)
 *   await loginAs(context, { email, password });   // any confirmed account
 *   await loginAs(context, "owner", { fresh: true });   // new session (e.g. a sign-out test)
 *
 * It signs in with @supabase/ssr's server client over an in-memory cookie jar (exactly the cookies
 * the app's proxy reads), then adds those cookies to the Playwright context for the baseURL host.
 * Sessions are cached per account in test-results/.auth for 45 minutes (access tokens last an
 * hour), so a run signs in each account about once and stays clear of Auth rate limits.
 *
 * `supabaseAs(who)` returns a signed-in supabase-js client for test setup and cleanup through the
 * app's RPCs (RLS applies, exactly like the app).
 *
 * Needs NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY and DEMO_PASSWORD
 * (loaded from .env.local by playwright.config.ts).
 */
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { BrowserContext } from "@playwright/test";
import { createServerClient, type CookieOptions } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../../src/lib/supabase/database.types";

export const ACCOUNTS = {
  /** Juan Dela Cruz, Owner PM of Dela Cruz Builders (4 projects). */
  owner: "owner@civpms.test",
  /** Maria Santos, PM on Cebu and Davao. */
  pm: "pm@civpms.test",
  /** Paolo Reyes, inspector on Cebu. */
  inspector: "inspector@civpms.test",
  /** Ana Villanueva, Owner PM of Bayanihan Construction (another tenant). */
  rival: "rival@civpms.test",
  /** Confirmed, not onboarded. */
  newbie: "newbie@civpms.test",
  /** e2e: Owner PM of "[FOUND] QA Builders" (set up by e2e/helpers/found-tenant.ts). */
  foundOwner: "found-owner@civpms.test",
  /** e2e: inspector in "No company yet"; specs make it join and leave. */
  foundInspector: "found-inspector@civpms.test",
} as const;

export type AccountKey = keyof typeof ACCOUNTS;
export type Who = AccountKey | { email: string; password?: string };

type JarCookie = { name: string; value: string; options: CookieOptions };
type CachedSession = { savedAt: number; userId: string; cookies: JarCookie[] };

const CACHE_DIR = path.join(process.cwd(), "test-results", ".auth");
const CACHE_TTL_MS = 45 * 60 * 1000;

function env(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is not set. Add it to .env.local (see .env.example and supabase/seed/README.md).`);
  }
  return value;
}

function credentials(who: Who): { email: string; password: string } {
  if (typeof who === "string") return { email: ACCOUNTS[who], password: env("DEMO_PASSWORD") };
  return { email: who.email, password: who.password ?? env("DEMO_PASSWORD") };
}

function cachePath(email: string): string {
  const key = createHash("sha256").update(`${env("NEXT_PUBLIC_SUPABASE_URL")}|${email}`).digest("hex").slice(0, 24);
  return path.join(CACHE_DIR, `${key}.json`);
}

async function readCache(email: string): Promise<CachedSession | null> {
  try {
    const cached = JSON.parse(await readFile(cachePath(email), "utf8")) as CachedSession;
    return Date.now() - cached.savedAt < CACHE_TTL_MS && cached.cookies.length > 0 ? cached : null;
  } catch {
    return null;
  }
}

async function signIn(email: string, password: string): Promise<CachedSession> {
  const jar = new Map<string, JarCookie>();
  const supabase = createServerClient<Database>(env("NEXT_PUBLIC_SUPABASE_URL"), env("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"), {
    cookies: {
      getAll: () => [...jar.values()].map(({ name, value }) => ({ name, value })),
      setAll: (cookies) => {
        for (const cookie of cookies) {
          if (!cookie.value || cookie.options.maxAge === 0) jar.delete(cookie.name);
          else jar.set(cookie.name, cookie);
        }
      },
    },
  });
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error || !data.user) {
    throw new Error(`Sign-in failed for ${email}: ${error?.code ?? error?.message ?? "no user"}`);
  }
  return { savedAt: Date.now(), userId: data.user.id, cookies: [...jar.values()] };
}

/** Signs in (or reuses a cached session) and returns the auth cookies + user id. */
export async function sessionFor(who: Who, options: { fresh?: boolean } = {}): Promise<CachedSession & { email: string }> {
  const { email, password } = credentials(who);
  if (!options.fresh) {
    const cached = await readCache(email);
    if (cached) return { ...cached, email };
  }
  const session = await signIn(email, password);
  if (!options.fresh) {
    await mkdir(CACHE_DIR, { recursive: true });
    await writeFile(cachePath(email), JSON.stringify(session), { mode: 0o600 });
  }
  return { ...session, email };
}

/**
 * Signs the browser context in as `who` by adding the Supabase auth cookies for the baseURL host.
 * Returns the user id and email.
 */
export async function loginAs(
  context: BrowserContext,
  who: Who,
  options: { fresh?: boolean; baseURL?: string } = {},
): Promise<{ userId: string; email: string }> {
  const session = await sessionFor(who, options);
  const baseURL = options.baseURL ?? process.env.BASE_URL ?? process.env.E2E_BASE_URL ?? "http://localhost:3200";
  const expires = Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 7;
  await context.clearCookies();
  await context.addCookies(
    session.cookies.map(({ name, value, options: cookieOptions }) => ({
      name,
      value,
      url: baseURL,
      httpOnly: Boolean(cookieOptions.httpOnly),
      secure: Boolean(cookieOptions.secure) && baseURL.startsWith("https:"),
      sameSite: "Lax" as const,
      expires,
    })),
  );
  return { userId: session.userId, email: session.email };
}

/**
 * A Supabase client signed in as `who` (for setup and cleanup through the app's RPCs; RLS
 * applies). Reuses the cached session, so it costs no extra sign-in.
 */
export async function supabaseAs(who: Who): Promise<{ client: SupabaseClient<Database>; userId: string; email: string }> {
  const session = await sessionFor(who);
  const jar = new Map(session.cookies.map((cookie) => [cookie.name, cookie]));
  const client = createServerClient<Database>(env("NEXT_PUBLIC_SUPABASE_URL"), env("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"), {
    cookies: {
      getAll: () => [...jar.values()].map(({ name, value }) => ({ name, value })),
      setAll: (cookies) => {
        for (const cookie of cookies) {
          if (!cookie.value || cookie.options.maxAge === 0) jar.delete(cookie.name);
          else jar.set(cookie.name, cookie);
        }
      },
    },
  });
  return { client, userId: session.userId, email: session.email };
}
