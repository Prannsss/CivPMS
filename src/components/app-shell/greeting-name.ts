/**
 * The name used in "Welcome back, <name>". Filipino teams often write professional titles in the
 * name ("Engr. Juan Dela Cruz", "Arch. Maria Santos"), and test or imported data may carry a tag
 * ("[QA] Ana Reyes"); greeting someone as "Engr." or "[QA]" reads wrong, so leading titles and
 * bracketed tags are skipped. Falls back to the whole name when nothing else is left.
 */
const TITLES = new Set([
  "engr",
  "engineer",
  "arch",
  "architect",
  "atty",
  "dr",
  "doc",
  "mr",
  "mrs",
  "ms",
  "miss",
  "sir",
  "maam",
  "madam",
  "hon",
  "prof",
  "rev",
  "fr",
]);

function isTitle(token: string): boolean {
  return TITLES.has(token.toLowerCase().replace(/[.'’]/g, ""));
}

function isTag(token: string): boolean {
  return /^[[(].*[\])]$/.test(token) || !/\p{L}/u.test(token);
}

export function greetingName(fullName: string): string {
  const tokens = fullName.trim().split(/\s+/).filter(Boolean);
  const first = tokens.find((token) => !isTag(token) && !isTitle(token));
  return first ?? (fullName.trim() || fullName);
}
