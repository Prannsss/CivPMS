/**
 * Safe decimal rounding for money (pesos, 2 decimals) and other display values.
 * `Math.round(1.005 * 100) / 100` gives 1 because 1.005 is stored as 1.00499…;
 * shifting the decimal point through the string exponent avoids that class of bug.
 */
import { DomainError } from "./errors";

/** Largest budget accepted (fits numeric(14,2)). */
export const MAX_MONEY = 999_999_999_999.99;

function shift(value: number, places: number): number {
  const [mantissa, exponent = "0"] = String(value).split("e");
  return Number(`${mantissa}e${Number(exponent) + places}`);
}

/** Rounds half away from zero to `decimals` places: roundTo(1.005, 2) === 1.01, roundTo(-1.005, 2) === -1.01. */
export function roundTo(value: number, decimals: number): number {
  if (!Number.isFinite(value)) throw new DomainError("INVALID_NUMBER", `Cannot round ${value}`);
  if (!Number.isInteger(decimals) || decimals < 0) {
    throw new DomainError("INVALID_NUMBER", `Invalid decimals: ${decimals}`);
  }
  const sign = value < 0 ? -1 : 1;
  const rounded = shift(Math.round(shift(Math.abs(value), decimals)), -decimals);
  return rounded === 0 ? 0 : sign * rounded;
}

/** Rounds to centavos (2 decimals). */
export function roundMoney(value: number): number {
  return roundTo(value, 2);
}

/** Converts pesos to integer centavos (rounded). */
export function toCents(value: number): number {
  return Math.round(roundMoney(value) * 100);
}

/** Sums money values without accumulating floating-point drift. Null/undefined count as 0. */
export function sumMoney(values: Iterable<number | null | undefined>): number {
  let cents = 0;
  for (const v of values) {
    if (typeof v === "number" && Number.isFinite(v)) cents += toCents(v);
  }
  return cents / 100;
}

/** True when `value` has at most `decimals` decimal places (tolerant of binary noise like 0.1 + 0.2). */
export function hasAtMostDecimals(value: number, decimals: number): boolean {
  if (!Number.isFinite(value)) return false;
  return Math.abs(roundTo(value, decimals) - value) < 1e-9 * Math.max(1, Math.abs(value));
}

/**
 * Parses a numeric form input such as "1,250,000.50", "₱ 1,000", " 12 " into a number.
 * Returns null for empty input and NaN for text that is not a number, so callers can tell
 * "missing" from "invalid". Numbers pass through unchanged.
 */
export function parseNumericInput(input: unknown): number | null {
  if (input === null || input === undefined) return null;
  if (typeof input === "number") return input;
  if (typeof input !== "string") return Number.NaN;
  const cleaned = input.replace(/[₱,\s]/g, "").replace(/^PHP/i, "");
  if (cleaned === "") return null;
  if (!/^[-+]?(\d+\.?\d*|\.\d+)$/.test(cleaned)) return Number.NaN;
  return Number(cleaned);
}
