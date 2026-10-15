/**
 * Typed environment access.
 *
 * - `publicEnv` holds the two browser-safe values. It is validated when this module is first
 *   imported, so a missing variable fails fast with a message naming it.
 * - `serverEnv()` reads server-only values at call time. It throws if called in the browser.
 *   Optional secrets (Supabase secret key, Brevo, cron secret) come back as `null`; features that
 *   need them degrade gracefully and log once through `warnOnce()`.
 * - `DEMO_PASSWORD` (seeded demo/test accounts) is dev/test only: it is ignored, with one warning,
 *   on Vercel production deployments.
 *
 * Next.js inlines `process.env.NEXT_PUBLIC_*` only when the property is written out literally,
 * so each public variable is read by name below (never through a dynamic key).
 */
import { z } from "zod";

/** Treats unset and blank values (`KEY=` in .env files) the same. */
function blankToUndefined(value: unknown): unknown {
  if (typeof value !== "string") return value;
  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed;
}

const optionalString = z.preprocess(blankToUndefined, z.string().optional());

const publicSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.preprocess(
    blankToUndefined,
    z.url({ protocol: /^https?$/, error: "must be a URL such as https://<project-ref>.supabase.co" }),
  ),
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: z.preprocess(
    blankToUndefined,
    z.string({ error: "is required (Supabase → Project Settings → API Keys → publishable key)" }),
  ),
});

export interface PublicEnv {
  supabaseUrl: string;
  supabasePublishableKey: string;
}

function formatEnvIssues(error: z.ZodError, scope: string): string {
  const lines = error.issues.map((issue) => {
    const name = issue.path.map(String).join(".") || "(env)";
    // Env values are strings or undefined, so a type error can only mean "not set".
    const missing = issue.code === "invalid_type";
    return `  - ${name}: ${missing ? "is missing" : issue.message}`;
  });
  return `Invalid ${scope} environment variables:\n${lines.join("\n")}\nSet them in .env.local (see .env.example and docs/SETUP.md).`;
}

/** Parses the public variables; exported for tests. Throws an Error naming each bad variable. */
export function parsePublicEnv(source: Record<string, string | undefined>): PublicEnv {
  const parsed = publicSchema.safeParse(source);
  if (!parsed.success) {
    throw new Error(formatEnvIssues(parsed.error, "public"));
  }
  return {
    supabaseUrl: parsed.data.NEXT_PUBLIC_SUPABASE_URL.replace(/\/+$/, ""),
    supabasePublishableKey: parsed.data.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  };
}

export const publicEnv: PublicEnv = parsePublicEnv({
  NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
});

/**
 * Optional base URL of the CivPMS media service (avatar uploads). `null` when unset or invalid,
 * in which case the browser resizes and uploads avatars to Supabase Storage itself.
 */
export function parseMediaApiUrl(value: string | undefined): string | null {
  const v = blankToUndefined(value);
  if (typeof v !== "string") return null;
  try {
    const url = new URL(v);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return url.href.replace(/\/+$/, "");
  } catch {
    return null;
  }
}

export const publicMediaApiUrl: string | null = parseMediaApiUrl(process.env.NEXT_PUBLIC_MEDIA_API_URL);

// ---------------------------------------------------------------------------
// Server-only values
// ---------------------------------------------------------------------------

const booleanFlag = z.preprocess((value) => {
  const v = blankToUndefined(value);
  if (typeof v !== "string") return v;
  return ["1", "true", "yes", "on"].includes(v.toLowerCase());
}, z.boolean().default(false));

const serverSchema = z.object({
  APP_URL: optionalString,
  VERCEL_ENV: optionalString,
  VERCEL_URL: optionalString,
  VERCEL_PROJECT_PRODUCTION_URL: optionalString,
  SUPABASE_SECRET_KEY: optionalString,
  BREVO_API_KEY: optionalString,
  BREVO_SENDER_EMAIL: z.preprocess(
    blankToUndefined,
    z.email({ error: "must be an email address verified as a sender in Brevo" }).optional(),
  ),
  BREVO_SENDER_NAME: optionalString,
  BREVO_SANDBOX: booleanFlag,
  CRON_SECRET: optionalString,
  DEMO_PASSWORD: optionalString,
});

export interface ServerEnv {
  /** Absolute origin used in email links and auth redirects, without a trailing slash. */
  appUrl: string;
  /** Supabase secret key (server only). `null` when not configured. */
  supabaseSecretKey: string | null;
  brevoApiKey: string | null;
  brevoSenderEmail: string | null;
  brevoSenderName: string;
  /** When true, Brevo validates requests but drops the emails (`X-Sib-Sandbox: drop`). */
  brevoSandbox: boolean;
  cronSecret: string | null;
  /** Password of the seeded demo/test accounts (dev and e2e only). Always `null` on Vercel production. */
  demoPassword: string | null;
}

const DEFAULT_APP_URL = "http://localhost:3000";

function toOrigin(value: string): string | null {
  const withScheme = /^https?:\/\//i.test(value) ? value : `https://${value}`;
  try {
    const url = new URL(withScheme);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return url.origin;
  } catch {
    return null;
  }
}

/**
 * APP_URL wins. On Vercel without APP_URL: production deployments use the project's production
 * domain, previews use their own deployment URL. Locally: http://localhost:3000.
 */
export function resolveAppUrl(env: {
  APP_URL?: string;
  VERCEL_ENV?: string;
  VERCEL_URL?: string;
  VERCEL_PROJECT_PRODUCTION_URL?: string;
}): string {
  const candidates =
    env.VERCEL_ENV === "production"
      ? [env.APP_URL, env.VERCEL_PROJECT_PRODUCTION_URL, env.VERCEL_URL]
      : [env.APP_URL, env.VERCEL_URL, env.VERCEL_PROJECT_PRODUCTION_URL];
  for (const candidate of candidates) {
    if (!candidate) continue;
    const origin = toOrigin(candidate);
    if (origin) return origin;
    if (candidate === env.APP_URL) warnOnce("env:APP_URL", `APP_URL "${candidate}" is not a valid URL; ignoring it.`);
  }
  return DEFAULT_APP_URL;
}

/** Parses server variables from a source object; exported for tests. Never throws. */
export function parseServerEnv(source: Record<string, string | undefined>): ServerEnv {
  const parsed = serverSchema.safeParse(source);
  let data: z.output<typeof serverSchema>;
  if (parsed.success) {
    data = parsed.data;
  } else {
    // Keep the app running: drop the invalid optional values and say which ones once.
    warnOnce("env:server-invalid", formatEnvIssues(parsed.error, "server"));
    const invalid = new Set(parsed.error.issues.map((issue) => String(issue.path[0])));
    const cleaned: Record<string, string | undefined> = {};
    for (const [key, value] of Object.entries(source)) {
      if (!invalid.has(key)) cleaned[key] = value;
    }
    data = serverSchema.parse(cleaned);
  }
  return {
    appUrl: resolveAppUrl(data),
    supabaseSecretKey: data.SUPABASE_SECRET_KEY ?? null,
    brevoApiKey: data.BREVO_API_KEY ?? null,
    brevoSenderEmail: data.BREVO_SENDER_EMAIL ?? null,
    brevoSenderName: data.BREVO_SENDER_NAME ?? "CivPMS",
    brevoSandbox: data.BREVO_SANDBOX,
    cronSecret: data.CRON_SECRET ?? null,
    demoPassword: resolveDemoPassword(data.DEMO_PASSWORD, data.VERCEL_ENV),
  };
}

function resolveDemoPassword(value: string | undefined, vercelEnv: string | undefined): string | null {
  if (!value) return null;
  if (vercelEnv === "production") {
    warnOnce("env:demo-password-production", "DEMO_PASSWORD is ignored on production deployments; remove it from the Vercel project.");
    return null;
  }
  return value;
}

/**
 * Server-only configuration, read from `process.env` on every call (cheap, and keeps tests that
 * stub variables honest). Throws when called from browser code.
 */
export function serverEnv(): ServerEnv {
  if (typeof window !== "undefined") {
    throw new Error("serverEnv() is server-only and must not be called from browser code.");
  }
  return parseServerEnv({
    APP_URL: process.env.APP_URL,
    VERCEL_ENV: process.env.VERCEL_ENV,
    VERCEL_URL: process.env.VERCEL_URL,
    VERCEL_PROJECT_PRODUCTION_URL: process.env.VERCEL_PROJECT_PRODUCTION_URL,
    SUPABASE_SECRET_KEY: process.env.SUPABASE_SECRET_KEY,
    BREVO_API_KEY: process.env.BREVO_API_KEY,
    BREVO_SENDER_EMAIL: process.env.BREVO_SENDER_EMAIL,
    BREVO_SENDER_NAME: process.env.BREVO_SENDER_NAME,
    BREVO_SANDBOX: process.env.BREVO_SANDBOX,
    CRON_SECRET: process.env.CRON_SECRET,
    DEMO_PASSWORD: process.env.DEMO_PASSWORD,
  });
}

const warned = new Set<string>();

/** Logs a warning the first time `key` is seen in this process (e.g. a missing optional secret). */
export function warnOnce(key: string, message: string): void {
  if (warned.has(key)) return;
  warned.add(key);
  console.warn(`[CivPMS] ${message}`);
}

/** Test helper: forget which warnings were already logged. */
export function resetWarnOnce(): void {
  warned.clear();
}
