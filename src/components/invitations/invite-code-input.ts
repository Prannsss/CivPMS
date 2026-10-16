/**
 * As-you-type formatting for `XXXX-XXXX` invite codes (D11): upper-case, separators and other
 * symbols dropped, the look-alikes O → 0 and I/L → 1 corrected (the same rules as
 * `normalizeInviteCode` in src/lib/domain), at most 8 characters, dash re-inserted after 4.
 * Validation stays with `inviteCodeSchema`; this only shapes what the field shows.
 */
export function formatInviteCodeInput(raw: string): string {
  const compact = raw
    .toUpperCase()
    .replace(/[^0-9A-Z]/g, "")
    .replace(/O/g, "0")
    .replace(/[IL]/g, "1")
    .slice(0, 8);
  return compact.length > 4 ? `${compact.slice(0, 4)}-${compact.slice(4)}` : compact;
}
