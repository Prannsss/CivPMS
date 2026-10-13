/**
 * Route access rules used by `src/proxy.ts` (kept here, pure, so they are unit-testable).
 *
 * - Public: auth pages, auth route handlers, invitation landing pages, cron endpoints, and the
 *   design-system showcase outside production.
 * - Auth pages (`/login`, `/signup`) send signed-in users home (or to a safe `next`).
 * - Everything else needs a session; the proxy redirects to `/login?next=<path+search>`.
 */

export const LOGIN_PATH = "/login";
export const ONBOARDING_PATH = "/onboarding";
export const HOME_PATH = "/";
export const RESET_PASSWORD_PATH = "/reset-password";

/** Pages that make no sense while signed in. */
const AUTH_PAGES = ["/login", "/signup"];

/** Reachable without a session (each also covers its sub-paths). */
const PUBLIC_PATHS = [
  "/login",
  "/signup",
  "/forgot-password",
  "/reset-password",
  "/check-email",
  "/auth",
  "/invite",
  "/api/cron",
];

/** Public only outside production (the pages themselves 404 in production). */
const DEV_ONLY_PUBLIC_PATHS = ["/dev"];

const STATIC_PREFIXES = ["/_next/", "/brand/", "/icons/"];
const STATIC_FILES = new Set([
  "/favicon.ico",
  "/icon.png",
  "/apple-icon.png",
  "/robots.txt",
  "/sitemap.xml",
  "/manifest.webmanifest",
]);
const STATIC_EXTENSION = /\.(?:svg|png|jpe?g|gif|webp|avif|ico|bmp|woff2?|ttf|otf|txt|xml|webmanifest|map)$/i;

/** True for `base` itself and anything below it (`/invite` matches `/invite/abc`, not `/invites`). */
export function matchesPath(pathname: string, base: string): boolean {
  return pathname === base || pathname.startsWith(`${base}/`);
}

export function isStaticAssetPath(pathname: string): boolean {
  return (
    STATIC_FILES.has(pathname) ||
    STATIC_PREFIXES.some((prefix) => pathname.startsWith(prefix)) ||
    STATIC_EXTENSION.test(pathname)
  );
}

export function isAuthPage(pathname: string): boolean {
  return AUTH_PAGES.some((base) => matchesPath(pathname, base));
}

export function isCronPath(pathname: string): boolean {
  return matchesPath(pathname, "/api/cron");
}

export function isPublicPath(pathname: string, options: { isProduction: boolean }): boolean {
  if (isStaticAssetPath(pathname)) return true;
  if (PUBLIC_PATHS.some((base) => matchesPath(pathname, base))) return true;
  if (!options.isProduction && DEV_ONLY_PUBLIC_PATHS.some((base) => matchesPath(pathname, base))) return true;
  return false;
}

export function isApiPath(pathname: string): boolean {
  return matchesPath(pathname, "/api");
}

/** `/login?error=link_invalid` (see authRedirectParam/authRedirectError in src/lib/errors.ts). */
export function loginErrorPath(errorParam: string): string {
  const params = new URLSearchParams({ error: errorParam });
  return `${LOGIN_PATH}?${params.toString()}`;
}

/** `/login?next=%2Fprojects%2F1%3Ftab%3Dwbs` for the page the visitor asked for. */
export function loginRedirectPath(pathname: string, search = ""): string {
  const params = new URLSearchParams({ next: `${pathname}${search}` });
  return `${LOGIN_PATH}?${params.toString()}`;
}
