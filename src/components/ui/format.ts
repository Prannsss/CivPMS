/**
 * Display formatting used by UI primitives (money meters, currency input).
 * Money is PHP only: `₱1,234,567.89`; compact `₱8.2M`.
 */

const pesoFormatter = new Intl.NumberFormat("en-PH", {
  style: "currency",
  currency: "PHP",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const groupedFormatter = new Intl.NumberFormat("en-PH", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** `₱1,234,567.89` */
export function formatPeso(value: number): string {
  return pesoFormatter.format(value);
}

/**
 * `₱8.2M`, `₱950K`, `₱1.2B` — for meters and tight spaces.
 * Hand-rolled (not Intl compact notation) so server and browser ICU versions render identically.
 */
export function formatPesoCompact(value: number): string {
  const sign = value < 0 ? "-" : "";
  const abs = Math.abs(value);
  const units: [number, string][] = [
    [1e9, "B"],
    [1e6, "M"],
    [1e3, "K"],
  ];
  for (const [size, suffix] of units) {
    if (abs >= size) {
      const scaled = Math.round((abs / size) * 10) / 10;
      // 999.96K rounds to 1000K → promote to the next unit.
      if (scaled >= 1000 && suffix !== "B") continue;
      return `${sign}₱${scaled.toLocaleString("en-US", { maximumFractionDigits: 1 })}${suffix}`;
    }
  }
  return `${sign}₱${Math.round(abs).toLocaleString("en-US")}`;
}

/** `1,234,567.89` (no symbol) — the currency input's blurred display. */
export function formatGrouped(value: number): string {
  return groupedFormatter.format(value);
}

/** Parses user input like "1,234,567.8" or "1234567" into a number; null when empty or invalid. */
export function parseDecimal(input: string): number | null {
  const cleaned = input.replace(/[₱,\s]/g, "");
  if (cleaned === "" || cleaned === "." || cleaned === "-") return null;
  if (!/^-?\d*\.?\d*$/.test(cleaned)) return null;
  const value = Number(cleaned);
  return Number.isFinite(value) ? value : null;
}
