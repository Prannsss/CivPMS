/**
 * Open-redirect guard for `?next=` parameters (login, OAuth callback, email links).
 *
 * Only same-origin, root-relative paths survive. Everything else (absolute URLs, protocol-relative
 * `//host`, backslash tricks such as `/\host`, `javascript:` and friends, control characters, and
 * percent-encoded versions of all of these) falls back. Auth pages themselves are rejected too,
 * so a `next` can never bounce the user back into the sign-in flow in a loop.
 *
 * Pure and dependency-free so it can run in the proxy, route handlers and client components.
 */

const BASE = "http://next.invalid";
const MAX_LENGTH = 2048;
const MAX_DECODE_PASSES = 3;

const CONTROL_CHARS = /[\u0000-\u001F\u007F]/;

/** Paths that must never be a post-auth destination (they would loop or sign the user out). */
const BLOCKED_PREFIXES = ["/login", "/signup", "/auth/"];

function isBlockedPath(pathname: string): boolean {
  const lower = pathname.toLowerCase();
  return BLOCKED_PREFIXES.some((prefix) =>
    prefix.endsWith("/") ? lower.startsWith(prefix) : lower === prefix || lower.startsWith(`${prefix}/`),
  );
}

function looksUnsafe(value: string): boolean {
  return (
    !value.startsWith("/") ||
    value.startsWith("//") ||
    value.includes("\\") ||
    CONTROL_CHARS.test(value)
  );
}

/**
 * Returns `raw` as a safe root-relative path (`/projects/1?tab=wbs`), or `fallback` when it is
 * missing or unsafe. The result is normalised by the URL parser (`/a/../b` → `/b`).
 */
export function safeNextPath(raw: string | null | undefined, fallback = "/"): string {
  if (typeof raw !== "string") return fallback;
  const value = raw.trim();
  if (value === "" || value.length > MAX_LENGTH) return fallback;

  // Check the raw value and every decoded layer, so encoded tricks cannot slip through.
  let layer = value;
  for (let pass = 0; pass <= MAX_DECODE_PASSES; pass++) {
    if (looksUnsafe(layer)) return fallback;
    let decoded: string;
    try {
      decoded = decodeURIComponent(layer);
    } catch {
      break; // a lone "%" (e.g. "?q=100%25" decoded once); this layer was already checked
    }
    if (decoded === layer) break;
    layer = decoded;
    if (pass === MAX_DECODE_PASSES) return fallback; // still changing: give up
  }

  let url: URL;
  try {
    url = new URL(value, BASE);
  } catch {
    return fallback;
  }
  if (url.origin !== BASE) return fallback;
  if (isBlockedPath(url.pathname)) return fallback;

  const result = `${url.pathname}${url.search}${url.hash}`;
  return looksUnsafe(result) ? fallback : result;
}
