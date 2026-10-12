/**
 * Invite codes (docs/DECISIONS.md D11): `XXXX-XXXX` in Crockford base32 (~40 bits).
 * Users type them from chat or paper, so input is forgiving: case-insensitive, spaces and
 * dashes ignored, and the look-alikes O → 0 and I / L → 1 are corrected.
 */
import { DomainError } from "./errors";

/** Crockford base32 alphabet (no I, L, O, U). */
export const INVITE_CODE_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
export const INVITE_CODE_LENGTH = 8;

const CANONICAL_RE = /^[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/;

/** True when the value is already a canonical code (`7KQ2-M9XA`). Does not normalize. */
export function isInviteCodeFormat(value: unknown): value is string {
  return typeof value === "string" && CANONICAL_RE.test(value);
}

/**
 * Normalizes user input into a canonical `XXXX-XXXX` code, or null when it cannot be one
 * (wrong length or characters outside the alphabet, e.g. 'U').
 */
export function normalizeInviteCode(input: string | null | undefined): string | null {
  if (typeof input !== "string") return null;
  const compact = input
    .toUpperCase()
    .replace(/[\s\u2010-\u2015_-]/g, "")
    .replace(/O/g, "0")
    .replace(/[IL]/g, "1");
  if (compact.length !== INVITE_CODE_LENGTH) return null;
  for (const ch of compact) {
    if (!INVITE_CODE_ALPHABET.includes(ch)) return null;
  }
  return `${compact.slice(0, 4)}-${compact.slice(4)}`;
}

/**
 * Builds a canonical code from at least 5 random bytes (40 bits). Pass bytes from
 * `crypto.getRandomValues(new Uint8Array(5))`; randomness stays outside the domain module.
 */
export function inviteCodeFromBytes(bytes: Uint8Array): string {
  if (bytes.length < 5) {
    throw new DomainError("INVALID_NUMBER", "inviteCodeFromBytes needs at least 5 bytes (40 bits).");
  }
  // 40 bits fit exactly in a double (< 2^53), so plain arithmetic is exact.
  let value = 0;
  for (let i = 0; i < 5; i += 1) value = value * 256 + bytes[i]!;
  let out = "";
  for (let i = INVITE_CODE_LENGTH - 1; i >= 0; i -= 1) {
    out += INVITE_CODE_ALPHABET[Math.floor(value / 32 ** i) % 32];
  }
  return `${out.slice(0, 4)}-${out.slice(4)}`;
}
