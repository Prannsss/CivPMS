/** Lower-case and strip accents, so "jose" finds "José" and "ñ" matches "n". */
export function normalizeForSearch(text: string): string {
  return text.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase().trim();
}

/**
 * True when every word of `query` appears somewhere in `haystack` (any order, accent- and
 * case-insensitive). An empty query matches everything. "bridge pan" finds "Panay Bridge Retrofit".
 */
export function matchesQuery(haystack: string, query: string): boolean {
  const words = normalizeForSearch(query).split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  const text = normalizeForSearch(haystack);
  return words.every((word) => text.includes(word));
}
