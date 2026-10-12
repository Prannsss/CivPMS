/** "Juan Dela Cruz" → "JC", "maria@site.ph" → "MA". */
export function getInitials(name: string): string {
  const cleaned = name.trim().replace(/@.*$/, "");
  if (!cleaned) return "?";
  const parts = cleaned.split(/[\s._-]+/).filter(Boolean);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/** Project initials from the first two words: "Davao Drainage Rehabilitation, Phase 2" → "DD". */
export function getProjectInitials(name: string): string {
  const words = name
    .trim()
    .split(/[\s,._/-]+/)
    .filter((word) => /[a-z]/i.test(word));
  if (words.length === 0) return name.trim().slice(0, 2).toUpperCase() || "?";
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}

/** Stable palette index for a string (same name → same color everywhere). */
export function hashToIndex(value: string, modulo: number): number {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) hash = (hash * 31 + value.charCodeAt(i)) | 0;
  return Math.abs(hash) % modulo;
}
