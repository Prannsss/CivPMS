/**
 * S-curve model (spec §9.2, §5.4; docs/DECISIONS.md D68, Stage A). The planned line comes from the
 * baseline's work packages: each one's weight (cost or hours, §6.5 fallbacks) is spread evenly over
 * its working days, and the curve is the cumulative share at the end of each day, flat at 100 % after
 * the last one. Stage A uses the current working calendar (baselines get a calendar snapshot in
 * Phase 2, P2-08) and has no actual line yet: progress updates arrive in Phase 3.
 */
import { isWorkingDay, type CalendarIndex } from "./calendar";
import { addDays, diffDays, maxISO, minISO, type ISODate } from "./dates";
import { leafWeight, type ProgressWeighting } from "./rollup";

export type SCurveBasis = ProgressWeighting;

export interface SCurveLeaf {
  start: ISODate | null;
  end: ISODate | null;
  cost: number;
  hours: number;
}

export interface SCurvePoint {
  date: ISODate;
  /** Cumulative planned %, 0–100, at the end of this day. */
  percent: number;
  /** The same share of the baseline total (₱ or hours). */
  value: number;
}

export interface PlannedCurve {
  /** One point per calendar day from `start` to `end`. */
  points: SCurvePoint[];
  start: ISODate;
  end: ISODate;
  /** Σ cost or Σ hours of the dated baseline work packages (the value axis). */
  total: number;
  /** Last planned working day (the curve reaches 100 % here), null without dated work. */
  finish: ISODate | null;
  datedCount: number;
  /** Baseline work packages without dates: not on the curve. */
  undatedCount: number;
  /** Some weight used a §6.5 fallback (other basis, or equal weight). */
  usedFallbackWeight: boolean;
}

/** Days shown: from the earliest of project / baseline start to the latest of project / baseline end and today (while open). */
export function scurveRange(input: {
  projectStart: ISODate | null;
  projectEnd: ISODate | null;
  baselineStart: ISODate | null;
  baselineEnd: ISODate | null;
  today: ISODate;
  isOpen: boolean;
}): { start: ISODate; end: ISODate } {
  const start = minISO(input.projectStart, input.baselineStart) ?? input.today;
  const end = maxISO(input.projectEnd, input.baselineEnd, input.isOpen ? input.today : null) ?? start;
  return { start, end: end < start ? start : end };
}

/**
 * Planned cumulative curve over [range.start, range.end] (D68 rules, current calendar).
 * O(work packages + days): one working-day pass over the whole span, then difference arrays
 * (an even share per working day of each work package, point masses for milestones).
 */
export function plannedCumulative(input: {
  leaves: ReadonlyArray<SCurveLeaf>;
  basis: SCurveBasis;
  calendar: CalendarIndex;
  range: { start: ISODate; end: ISODate };
}): PlannedCurve {
  const { start, end } = input.range;
  const days = Math.max(0, diffDays(end, start) + 1);
  let total = 0;
  let totalWeight = 0;
  let undatedCount = 0;
  let usedFallbackWeight = false;
  const dated: { a: ISODate; b: ISODate; weight: number }[] = [];
  for (const leaf of input.leaves) {
    if (!leaf.start || !leaf.end) {
      undatedCount += 1;
      continue;
    }
    const { weight, usedFallback } = leafWeight({ estCost: leaf.cost, durationHours: leaf.hours }, input.basis);
    usedFallbackWeight ||= usedFallback;
    totalWeight += weight;
    total += Math.max(0, input.basis === "cost" ? leaf.cost : leaf.hours) || 0;
    dated.push({ a: leaf.start, b: leaf.end < leaf.start ? leaf.start : leaf.end, weight });
  }

  // The span covers the range and every dated work package.
  const spanStart = minISO(start, ...dated.map((d) => d.a)) as ISODate;
  const spanEnd = maxISO(end, ...dated.map((d) => d.b)) as ISODate;
  const spanDays = diffDays(spanEnd, spanStart) + 1;
  const working = new Uint8Array(spanDays);
  const workCount = new Int32Array(spanDays + 1); // working days before index i
  const lastWorking = new Int32Array(spanDays); // last working index ≤ i, or -1
  let date = spanStart;
  for (let i = 0; i < spanDays; i += 1) {
    working[i] = isWorkingDay(input.calendar, date) ? 1 : 0;
    workCount[i + 1] = workCount[i] + working[i];
    lastWorking[i] = working[i] ? i : i > 0 ? lastWorking[i - 1] : -1;
    date = addDays(date, 1);
  }

  const rate = new Float64Array(spanDays + 1); // per-working-day share, as a difference array
  const mass = new Float64Array(spanDays); // milestones and spans without a working day
  let finishIndex = -1;
  for (const leaf of dated) {
    const ia = diffDays(leaf.a, spanStart);
    const ib = diffDays(leaf.b, spanStart);
    const n = workCount[ib + 1] - workCount[ia];
    if (n > 0) {
      rate[ia] += leaf.weight / n;
      rate[ib + 1] -= leaf.weight / n;
      finishIndex = Math.max(finishIndex, lastWorking[ib]);
    } else {
      mass[ib] += leaf.weight;
      finishIndex = Math.max(finishIndex, ib);
    }
  }

  const offset = diffDays(start, spanStart);
  const points: SCurvePoint[] = [];
  let running = 0;
  let cumulative = 0;
  for (let i = 0; i < spanDays && i < offset + days; i += 1) {
    running += rate[i];
    cumulative += running * working[i] + mass[i];
    if (i >= offset) {
      const percent = totalWeight > 0 ? Math.min(100, Math.max(0, (cumulative / totalWeight) * 100)) : 0;
      points.push({ date: addDays(start, i - offset), percent, value: (percent / 100) * total });
    }
  }
  return {
    points,
    start,
    end,
    total,
    finish: finishIndex >= 0 ? addDays(spanStart, finishIndex) : null,
    datedCount: dated.length,
    undatedCount,
    usedFallbackWeight,
  };
}

/** Planned % at a date: 0 before the curve, its last value after it. */
export function plannedPercentAt(curve: PlannedCurve, date: ISODate): number {
  if (curve.points.length === 0 || date < curve.start) return 0;
  if (date > curve.end) return curve.points[curve.points.length - 1].percent;
  return curve.points[diffDays(date, curve.start)].percent;
}

/**
 * At most `max` points for drawing: evenly spaced, always keeping the first and last day and any
 * `keep` dates (today, planned end) so markers sit exactly on the line.
 */
export function sampleSCurve(points: ReadonlyArray<SCurvePoint>, max = 400, keep: ReadonlyArray<ISODate> = []): SCurvePoint[] {
  if (points.length <= max) return [...points];
  const step = (points.length - 1) / (max - 1);
  const indexes = new Set<number>();
  for (let i = 0; i < max; i += 1) indexes.add(Math.round(i * step));
  const first = points[0].date;
  for (const date of keep) {
    const i = diffDays(date, first);
    if (i >= 0 && i < points.length) indexes.add(i);
  }
  return [...indexes].sort((a, b) => a - b).map((i) => points[i]);
}

/** Weekly rows for the table view (Mondays plus the last day), with the planned value. */
export function weeklyRows(points: ReadonlyArray<SCurvePoint>): SCurvePoint[] {
  if (points.length === 0) return [];
  const rows = points.filter((p, i) => i === 0 || new Date(`${p.date}T00:00:00Z`).getUTCDay() === 1);
  const last = points[points.length - 1];
  if (rows[rows.length - 1] !== last) rows.push(last);
  return rows;
}
