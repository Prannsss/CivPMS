/**
 * Response security headers for every route (applied in next.config.ts).
 *
 * The CSP limits where the page may connect, load images from, be framed by and post forms to.
 * Scripts keep 'unsafe-inline' because Next.js injects inline bootstrap scripts; a nonce-based
 * policy would need every page rendered per request (docs/DECISIONS.md D9a). Everything else
 * is an allowlist: this site, the Supabase project (REST, Auth, Storage, Realtime), the media
 * service, and Google photo hosts for avatars (the same hosts the database accepts, B-10).
 *
 * Pure so it can be unit-tested; inputs are the public env values known at build time.
 */

export type SecurityHeaderInput = {
  supabaseUrl?: string | null;
  mediaApiUrl?: string | null;
  isDev?: boolean;
};

function origin(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url.origin : null;
  } catch {
    return null;
  }
}

const GOOGLE_PHOTO_HOSTS = [
  "https://lh3.googleusercontent.com",
  "https://lh4.googleusercontent.com",
  "https://lh5.googleusercontent.com",
  "https://lh6.googleusercontent.com",
];

export function contentSecurityPolicy({ supabaseUrl, mediaApiUrl, isDev = false }: SecurityHeaderInput): string {
  const supabase = origin(supabaseUrl);
  // Without a configured URL (e.g. a CI build with placeholders) fall back to any Supabase project.
  const supabaseHttp = supabase ?? "https://*.supabase.co";
  const supabaseWs = supabase ? supabase.replace(/^http/, "ws") : "wss://*.supabase.co";
  const media = origin(mediaApiUrl);

  const directives: Record<string, string[]> = {
    "default-src": ["'self'"],
    "script-src": ["'self'", "'unsafe-inline'", ...(isDev ? ["'unsafe-eval'"] : [])],
    "style-src": ["'self'", "'unsafe-inline'"],
    "img-src": ["'self'", "data:", "blob:", supabaseHttp, ...GOOGLE_PHOTO_HOSTS],
    "font-src": ["'self'", "data:"],
    "connect-src": ["'self'", supabaseHttp, supabaseWs, ...(media ? [media] : []), ...(isDev ? ["ws:"] : [])],
    "media-src": ["'self'", "blob:"],
    "worker-src": ["'self'", "blob:"],
    "frame-src": ["'none'"],
    "frame-ancestors": ["'none'"],
    "object-src": ["'none'"],
    "base-uri": ["'self'"],
    "form-action": ["'self'"],
    "manifest-src": ["'self'"],
  };
  // No `upgrade-insecure-requests`: production is HTTPS-only (HSTS) and every URL we use is https;
  // the directive would only break a production build served on http://localhost.
  return Object.entries(directives)
    .map(([name, values]) => `${name} ${values.join(" ")}`)
    .join("; ");
}

export function securityHeaders(input: SecurityHeaderInput): { key: string; value: string }[] {
  return [
    { key: "Content-Security-Policy", value: contentSecurityPolicy(input) },
    { key: "X-Frame-Options", value: "DENY" },
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    // Camera and location stay available to this site (site photos, Phase 3); nothing else.
    { key: "Permissions-Policy", value: "camera=(self), geolocation=(self), microphone=(), payment=(), usb=(), browsing-topics=()" },
    { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  ];
}
