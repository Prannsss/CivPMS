/**
 * Display formatting (CLAUDE.md "Formatting", spec §17.1): money `₱1,234,567.89`,
 * dates `10 Oct 2026`, times in Asia/Manila. Pure functions; "now" is always passed in.
 */
import { isValidISODate, parseISODate, todayInManila, zonedParts, diffDays, type ISODate } from "./dates";
import { roundTo } from "./money";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;
const EMPTY = "—";

const pesoFormatter = new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const groupedFormatter = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 });

/** `₱1,234,567.89`; negatives as `-₱1,000.00`; always 2 decimals, rounded half away from zero. */
export function formatPeso(value: number | null | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return EMPTY;
  const rounded = roundTo(value, 2);
  const sign = rounded < 0 ? "-" : "";
  return `${sign}₱${pesoFormatter.format(Math.abs(rounded))}`;
}

const COMPACT_UNITS = [
  { size: 1e12, suffix: "T" },
  { size: 1e9, suffix: "B" },
  { size: 1e6, suffix: "M" },
  { size: 1e3, suffix: "K" },
] as const;

/** Short money for tight spaces: `₱950`, `₱950K`, `₱1.2M`, `₱3.5B` (1 decimal max, trimmed). */
export function formatPesoCompact(value: number | null | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return EMPTY;
  const sign = value < 0 ? "-" : "";
  const abs = Math.abs(value);
  // Walk from the smallest unit up so 999,950 becomes ₱1M rather than ₱1000K.
  let body = String(roundTo(abs, 0));
  if (roundTo(abs, 0) >= 1000) {
    for (let i = COMPACT_UNITS.length - 1; i >= 0; i -= 1) {
      const unit = COMPACT_UNITS[i]!;
      const scaled = roundTo(abs / unit.size, 1);
      if (scaled < 1000 || i === 0) {
        body = `${trimNumber(scaled)}${unit.suffix}`;
        break;
      }
    }
  }
  if (body === "0") return "₱0";
  return `${sign}₱${body}`;
}

function trimNumber(value: number): string {
  return groupedFormatter.format(value);
}

/** `10 Oct 2026`. Returns `—` for null/invalid input. */
export function formatDate(iso: ISODate | null | undefined): string {
  if (!isValidISODate(iso)) return EMPTY;
  const d = parseISODate(iso);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/** `10 Oct 2026` without the year: `10 Oct`. */
export function formatDayMonth(iso: ISODate | null | undefined): string {
  if (!isValidISODate(iso)) return EMPTY;
  const d = parseISODate(iso);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}

/**
 * `10 Oct – 12 Dec 2026` (year collapsed when shared), `10 Oct 2026 – 12 Jan 2027` across years,
 * `10 Oct 2026` when both are the same day. A missing side renders as `—`.
 */
export function formatDateRange(start: ISODate | null | undefined, end: ISODate | null | undefined): string {
  const startOk = isValidISODate(start);
  const endOk = isValidISODate(end);
  if (!startOk && !endOk) return EMPTY;
  if (!startOk || !endOk) return `${formatDate(start)} – ${formatDate(end)}`;
  if (start === end) return formatDate(start);
  if (start.slice(0, 4) === end.slice(0, 4)) return `${formatDayMonth(start)} – ${formatDate(end)}`;
  return `${formatDate(start)} – ${formatDate(end)}`;
}

function toInstant(value: string | Date): Date | null {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** `10 Oct 2026, 2:32 PM` in Asia/Manila. Returns `—` for invalid input. */
export function formatDateTime(timestamp: string | Date | null | undefined): string {
  if (timestamp === null || timestamp === undefined) return EMPTY;
  const instant = toInstant(timestamp);
  if (!instant) return EMPTY;
  const { year, month, day, hour, minute } = zonedParts(instant);
  return `${day} ${MONTHS[month - 1]} ${year}, ${formatClock(hour, minute)}`;
}

/** `2:32 PM` in Asia/Manila. */
export function formatTime(timestamp: string | Date | null | undefined): string {
  if (timestamp === null || timestamp === undefined) return EMPTY;
  const instant = toInstant(timestamp);
  if (!instant) return EMPTY;
  const { hour, minute } = zonedParts(instant);
  return formatClock(hour, minute);
}

function formatClock(hour: number, minute: number): string {
  const suffix = hour < 12 ? "AM" : "PM";
  const h12 = hour % 12 === 0 ? 12 : hour % 12;
  return `${h12}:${String(minute).padStart(2, "0")} ${suffix}`;
}

/**
 * Relative time for feeds and logs: `just now` (< 1 min), `5 min ago`, `3 h ago` (< 24 h),
 * `yesterday` (previous Manila calendar day), `3 Oct` (same year), `3 Oct 2025` (older).
 * Future timestamps within a minute read `just now`; further in the future show the date.
 */
export function formatRelativeTime(timestamp: string | Date, now: string | Date): string {
  const instant = toInstant(timestamp);
  const nowInstant = toInstant(now);
  if (!instant || !nowInstant) return EMPTY;
  const seconds = (nowInstant.getTime() - instant.getTime()) / 1000;
  if (Math.abs(seconds) < 60) return "just now";
  if (seconds > 0 && seconds < 3600) return `${Math.floor(seconds / 60)} min ago`;
  if (seconds > 0 && seconds < 86_400) return `${Math.floor(seconds / 3600)} h ago`;
  const day = todayInManila(instant);
  const today = todayInManila(nowInstant);
  if (diffDays(today, day) === 1) return "yesterday";
  return day.slice(0, 4) === today.slice(0, 4) ? formatDayMonth(day) : formatDate(day);
}

/** `45%`, or `45.5%` with `{ decimals: 1 }`. Returns `—` for non-numbers. */
export function formatPercent(value: number | null | undefined, options: { decimals?: number } = {}): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return EMPTY;
  const decimals = options.decimals ?? 0;
  const rounded = roundTo(value, decimals);
  return `${rounded.toFixed(decimals)}%`;
}

export type DurationUnit = "hours" | "days";

/**
 * Duration display per the Hours | Days toggle (§6.3): `12 h`, `1.5 d`, `1,200 h`.
 * Up to 2 decimals, trailing zeros trimmed. Storage is always hours.
 */
export function formatDuration(
  hours: number | null | undefined,
  unit: DurationUnit,
  hoursPerDay: number,
): string {
  if (typeof hours !== "number" || !Number.isFinite(hours)) return EMPTY;
  if (unit === "hours") return `${groupedFormatter.format(roundTo(hours, 2))} h`;
  if (!Number.isFinite(hoursPerDay) || hoursPerDay <= 0) return EMPTY;
  return `${groupedFormatter.format(roundTo(hours / hoursPerDay, 2))} d`;
}

const DURATION_RE = /^(\d+(?:\.\d*)?|\.\d+)\s*(h|hr|hrs|hour|hours|d|day|days)?$/;

/**
 * Parses a duration typed by the user into hours. A unit suffix wins over `unit`
 * (`'2d'`, `'1.5 days'`, `'12h'`, `'12 hrs'`); a bare number uses `unit`. Commas are ignored.
 * Returns null for empty, negative or unparseable text. Result rounded to 2 decimals.
 */
export function parseDurationInput(text: string, unit: DurationUnit, hoursPerDay: number): number | null {
  const cleaned = text.trim().toLowerCase().replace(/,/g, "");
  const match = DURATION_RE.exec(cleaned);
  if (!match) return null;
  const amount = Number(match[1]);
  const suffix = match[2];
  const inDays = suffix ? suffix.startsWith("d") : unit === "days";
  if (!inDays) return roundTo(amount, 2);
  if (!Number.isFinite(hoursPerDay) || hoursPerDay <= 0) return null;
  return roundTo(amount * hoursPerDay, 2);
}

/** Words of a name for initials: leading punctuation dropped, words without letters/digits skipped. */
function initialWords(text: string): string[] {
  return text
    .split(/[\s._-]+/)
    .map((word) => word.replace(/^[^\p{L}\p{N}]+/u, ""))
    .filter((word) => word.length > 0);
}

/**
 * Avatar initials: 'Maria Santos' → 'MS', 'maria' → 'M', 'maria@x.com' → 'M', '' → '?'.
 * A leading tag in brackets is skipped ('[QA] Ivan Reyes' → 'IR') unless it is all there is.
 */
export function initials(name: string | null | undefined): string {
  const base = (name ?? "").split("@")[0]!.trim();
  const untagged = initialWords(base.replace(/^[[(][^\])]*[\])]/, ""));
  const words = untagged.length > 0 ? untagged : initialWords(base);
  if (words.length === 0) return "?";
  const first = Array.from(words[0]!)[0]!;
  if (words.length === 1) return first.toUpperCase();
  const last = Array.from(words[words.length - 1]!)[0]!;
  return `${first}${last}`.toUpperCase();
}

/** The word only: pluralWord(1, 'activity', 'activities') → 'activity'. Default plural adds 's'. */
export function pluralWord(count: number, singular: string, plural?: string): string {
  return count === 1 ? singular : (plural ?? `${singular}s`);
}

/** Count and word: pluralize(4, 'work package') → '4 work packages'; thousands separated. */
export function pluralize(count: number, singular: string, plural?: string): string {
  return `${groupedFormatter.format(count)} ${pluralWord(count, singular, plural)}`;
}
