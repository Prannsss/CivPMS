/**
 * Typed date entry for the date pickers (pure; `today` is injected). Calendar dates are ISO strings
 * (`YYYY-MM-DD`). People in the Philippines write day-first, so `5/10/2026` is 5 October.
 */
import { addDays, isValidISODate, type ISODate } from "./dates";

const MONTHS = [
  "january", "february", "march", "april", "may", "june",
  "july", "august", "september", "october", "november", "december",
] as const;

/** "oct", "octo", "october" (and "sept") → 9; "octember" → null. */
function monthIndex(word: string): number | null {
  const key = word.toLowerCase();
  if (key.length < 3) return null;
  const index = MONTHS.findIndex((name) => name.startsWith(key) || (key === "sept" && name === "september"));
  return index === -1 ? null : index;
}

function iso(year: number, month0: number, day: number): ISODate | null {
  if (!Number.isInteger(year) || year < 1900 || year > 2200) return null;
  const value = `${String(year).padStart(4, "0")}-${String(month0 + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  return isValidISODate(value) ? value : null;
}

function yearOf(today: ISODate): number {
  return Number(today.slice(0, 4));
}

/** Adds whole calendar months, clamping the day (31 Jan + 1 month → 28/29 Feb). */
export function addMonths(date: ISODate, months: number): ISODate {
  const [y, m, d] = date.split("-").map(Number);
  const total = y * 12 + (m - 1) + months;
  const year = Math.floor(total / 12);
  const month0 = total - year * 12;
  const last = new Date(Date.UTC(year, month0 + 1, 0)).getUTCDate();
  return iso(year, month0, Math.min(d, last)) as ISODate;
}

export function startOfMonth(date: ISODate): ISODate {
  return `${date.slice(0, 7)}-01`;
}

export function endOfMonth(date: ISODate): ISODate {
  return addDays(addMonths(startOfMonth(date), 1), -1);
}

/**
 * One typed date → ISO, or null when it isn't a date. Accepts `2026-10-25`, `25 Oct 2026`,
 * `Oct 25, 2026`, `25/10/2026`, `25 Oct` (this year), `today`, `tomorrow`, `yesterday`, and offsets
 * such as `+3d`, `-2w`, `+1m`.
 */
export function parseDateEntry(text: string, today: ISODate): ISODate | null {
  const raw = text.trim().toLowerCase().replace(/,/g, " ").replace(/\s+/g, " ");
  if (raw === "") return null;
  if (raw === "today" || raw === "now") return today;
  if (raw === "tomorrow") return addDays(today, 1);
  if (raw === "yesterday") return addDays(today, -1);

  const offset = /^([+-])\s?(\d{1,3})\s?(d|day|days|w|wk|week|weeks|m|mo|month|months|y|yr|year|years)$/.exec(raw);
  if (offset) {
    const n = Number(offset[2]) * (offset[1] === "-" ? -1 : 1);
    const unit = offset[3][0];
    if (unit === "d") return addDays(today, n);
    if (unit === "w") return addDays(today, n * 7);
    if (unit === "m") return addMonths(today, n);
    return addMonths(today, n * 12);
  }

  let match = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(raw);
  if (match) return iso(Number(match[1]), Number(match[2]) - 1, Number(match[3]));

  match = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(raw);
  if (match) return iso(Number(match[3]), Number(match[2]) - 1, Number(match[1]));

  // 25 Oct 2026 · 25 October · Oct 25 2026 · October 25
  match = /^(\d{1,2}) ([a-z]+)(?: (\d{4}))?$/.exec(raw);
  if (match) {
    const month = monthIndex(match[2]);
    if (month !== null) return iso(match[3] ? Number(match[3]) : yearOf(today), month, Number(match[1]));
  }
  match = /^([a-z]+) (\d{1,2})(?: (\d{4}))?$/.exec(raw);
  if (match) {
    const month = monthIndex(match[1]);
    if (month !== null) return iso(match[3] ? Number(match[3]) : yearOf(today), month, Number(match[2]));
  }
  return null;
}

export type DateRange = { from: ISODate; to: ISODate };

export type DateRangePreset = { id: string; label: string; range: (today: ISODate) => DateRange };

/** Presets shown beside the range calendar (newest first, like Cloudflare's). */
export const DATE_RANGE_PRESETS: ReadonlyArray<DateRangePreset> = [
  { id: "today", label: "Today", range: (t) => ({ from: t, to: t }) },
  { id: "yesterday", label: "Yesterday", range: (t) => ({ from: addDays(t, -1), to: addDays(t, -1) }) },
  { id: "7d", label: "Last 7 days", range: (t) => ({ from: addDays(t, -6), to: t }) },
  { id: "30d", label: "Last 30 days", range: (t) => ({ from: addDays(t, -29), to: t }) },
  { id: "90d", label: "Last 90 days", range: (t) => ({ from: addDays(t, -89), to: t }) },
  { id: "this-month", label: "This month", range: (t) => ({ from: startOfMonth(t), to: t }) },
  {
    id: "last-month",
    label: "Last month",
    range: (t) => {
      const start = addMonths(startOfMonth(t), -1);
      return { from: start, to: endOfMonth(start) };
    },
  },
  { id: "this-year", label: "This year", range: (t) => ({ from: `${t.slice(0, 4)}-01-01`, to: t }) },
];

/**
 * A typed range → { from, to }, or null. Accepts spans ending today (`7d`, `7 days`, `2w`,
 * `3 months`, `1y`), the preset names (`today`, `last month`, …) and two dates joined by `-`, `–`
 * or `to` (`1 Oct - 15 Oct 2026`, `2026-10-01 to 2026-10-15`). The range is always ordered.
 */
export function parseRangeEntry(text: string, today: ISODate): DateRange | null {
  const raw = text.trim().toLowerCase().replace(/\s+/g, " ");
  if (raw === "") return null;
  const preset = DATE_RANGE_PRESETS.find((p) => p.label.toLowerCase() === raw || p.id === raw);
  if (preset) return preset.range(today);

  const span = /^(?:last )?(\d{1,3}) ?(d|day|days|w|wk|week|weeks|m|mo|month|months|y|yr|year|years)$/.exec(raw);
  if (span) {
    const n = Number(span[1]);
    if (n < 1) return null;
    const unit = span[2][0];
    const from =
      unit === "d" ? addDays(today, -(n - 1)) : unit === "w" ? addDays(today, -(n * 7 - 1)) : addDays(addMonths(today, unit === "m" ? -n : -n * 12), 1);
    return { from, to: today };
  }

  const parts = raw.split(/ ?(?:–|—| - | to ) ?/);
  if (parts.length === 2) {
    // "1 Oct - 15 Oct 2026": the second date's year carries over to the first.
    const second = parseDateEntry(parts[1], today);
    const firstText = /\d{4}/.test(parts[0]) || !second ? parts[0] : `${parts[0]} ${second.slice(0, 4)}`;
    const first = parseDateEntry(firstText, today);
    if (first && second) return first <= second ? { from: first, to: second } : { from: second, to: first };
  }
  const single = parseDateEntry(raw, today);
  return single ? { from: single, to: single } : null;
}

/** The weeks of a month for a Monday-first calendar grid (leading/trailing days of the neighbours). */
export function monthGrid(month: ISODate): ISODate[][] {
  const first = startOfMonth(month);
  const weekday = (new Date(`${first}T00:00:00Z`).getUTCDay() + 6) % 7; // Mon = 0
  let day = addDays(first, -weekday);
  const last = endOfMonth(month);
  const weeks: ISODate[][] = [];
  while (weeks.length < 6 && (weeks.length === 0 || day <= last)) {
    const week: ISODate[] = [];
    for (let i = 0; i < 7; i++) {
      week.push(day);
      day = addDays(day, 1);
    }
    weeks.push(week);
  }
  return weeks;
}
