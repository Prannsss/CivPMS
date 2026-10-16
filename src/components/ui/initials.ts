/** A leading tag in brackets, e.g. "[QA] " or "(Demo) ". Skipped for initials. */
const LEADING_TAG = /^[[(][^\])]*[\])]\s*/;

/** Words with leading punctuation removed; words without letters or digits are dropped. */
function wordsOf(text: string, separators: RegExp): string[] {
  return text
    .split(separators)
    .map((word) => word.replace(/^[^\p{L}\p{N}]+/u, ""))
    .filter((word) => word.length > 0);
}

function firstChar(word: string): string {
  return Array.from(word)[0] ?? "";
}

/** "Juan Dela Cruz" → "JC", "maria@site.ph" → "MA", "[QA] Ivan Reyes" → "IR". */
export function getInitials(name: string): string {
  const cleaned = name.trim().replace(/@.*$/, "");
  if (!cleaned) return "?";
  const separators = /[\s._-]+/;
  const untagged = wordsOf(cleaned.replace(LEADING_TAG, ""), separators);
  const parts = untagged.length > 0 ? untagged : wordsOf(cleaned, separators);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return Array.from(parts[0]).slice(0, 2).join("").toUpperCase();
  return (firstChar(parts[0]) + firstChar(parts[parts.length - 1])).toUpperCase();
}

/**
 * Project initials from the first two words with letters:
 * "Davao Drainage Rehabilitation, Phase 2" → "DD", "[QA] 0412 Mactan Bridge" → "MB".
 */
export function getProjectInitials(name: string): string {
  const trimmed = name.trim();
  const separators = /[\s,._/-]+/;
  const hasLetter = (word: string) => /\p{L}/u.test(word);
  let words = wordsOf(trimmed.replace(LEADING_TAG, ""), separators).filter(hasLetter);
  if (words.length === 0) words = wordsOf(trimmed, separators).filter(hasLetter);
  if (words.length === 0) return Array.from(trimmed).slice(0, 2).join("").toUpperCase() || "?";
  if (words.length === 1) return Array.from(words[0]).slice(0, 2).join("").toUpperCase();
  return (firstChar(words[0]) + firstChar(words[1])).toUpperCase();
}

/** Stable palette index for a string (same name → same color everywhere). */
export function hashToIndex(value: string, modulo: number): number {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) hash = (hash * 31 + value.charCodeAt(i)) | 0;
  return Math.abs(hash) % modulo;
}
