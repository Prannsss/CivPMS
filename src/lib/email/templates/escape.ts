/**
 * Escaping for email HTML. Every interpolated value goes through `escapeHtml` (text and quoted
 * attributes alike), and every link through `absoluteUrl`, which only allows http(s) URLs on the
 * app's own origin or root-relative paths.
 */
import { safeNextPath } from "@/lib/safe-next-path";

const HTML_ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
  "`": "&#96;",
};

export function escapeHtml(value: unknown): string {
  const text = value === null || value === undefined ? "" : String(value);
  return text.replace(/[&<>"'`]/g, (char) => HTML_ESCAPES[char] ?? char);
}

/** Removes line breaks and collapses whitespace (subjects, names inside sentences). */
export function singleLine(value: unknown, maxLength = 200): string {
  const text = value === null || value === undefined ? "" : String(value);
  const collapsed = text.replace(/\s+/g, " ").trim();
  return collapsed.length > maxLength ? `${collapsed.slice(0, maxLength - 1)}…` : collapsed;
}

/** Normalises the app origin (`https://app.example.com`), falling back to localhost. */
export function appOrigin(appUrl: string): string {
  try {
    const url = new URL(appUrl);
    if (url.protocol === "http:" || url.protocol === "https:") return url.origin;
  } catch {
    // fall through
  }
  return "http://localhost:3000";
}

/** `url` when it is an absolute http(s) URL, else `fallback` (blocks `javascript:` and friends). */
export function httpUrl(url: string, fallback: string): string {
  try {
    const parsed = new URL(url);
    if (parsed.protocol === "http:" || parsed.protocol === "https:") return parsed.toString();
  } catch {
    // fall through
  }
  return fallback;
}

/**
 * Absolute link for an app path (`/projects/1`). Anything that is not a safe root-relative path
 * becomes the app home, so a stored link can never point elsewhere.
 */
export function absoluteUrl(appUrl: string, path: string | null | undefined): string {
  const origin = appOrigin(appUrl);
  const safePath = safeNextPath(path ?? "/", "/");
  return new URL(safePath, `${origin}/`).toString();
}
