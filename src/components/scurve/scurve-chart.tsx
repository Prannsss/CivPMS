"use client";

import * as React from "react";
import {
  addDays,
  diffDays,
  formatDate,
  formatDayMonth,
  formatPercent,
  sampleSCurve,
  type ISODate,
  type SCurvePoint,
} from "@/lib/domain";
import { cn } from "@/lib/utils";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

export type SCurveChartProps = {
  /** One planned point per day. */
  points: SCurvePoint[];
  today: ISODate;
  projectEnd: ISODate | null;
  overrun: { start: ISODate; end: ISODate } | null;
  /** Formats a value on the second axis (₱ or hours). Null hides that axis. */
  formatValue: ((value: number) => string) | null;
  /** Compact form for axis labels. */
  formatValueShort: ((value: number) => string) | null;
  total: number;
  baselineLabel: string;
};

const MARGIN = { top: 16, bottom: 30, left: 44, right: 64 };

/**
 * Planned S-curve (custom SVG, D69). Hover, touch or the arrow keys move a crosshair; the readout
 * is mirrored in a live region for screen readers and kept inside the chart's edges.
 */
export function SCurveChart({ points, today, projectEnd, overrun, formatValue, formatValueShort, total, baselineLabel }: SCurveChartProps) {
  const wrapRef = React.useRef<HTMLDivElement>(null);
  const [width, setWidth] = React.useState(0);
  const [active, setActive] = React.useState<number | null>(null);

  React.useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const measure = () => setWidth(el.clientWidth);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const narrow = width > 0 && width < 520;
  const height = narrow ? 240 : 300;
  const margin = { ...MARGIN, right: formatValueShort && !narrow ? MARGIN.right : 12 };
  const innerW = Math.max(0, width - margin.left - margin.right);
  const innerH = height - margin.top - margin.bottom;
  const first = points[0]?.date;
  const last = points[points.length - 1]?.date;
  const span = first && last ? Math.max(1, diffDays(last, first)) : 1;

  const x = React.useCallback((date: ISODate) => (first ? (diffDays(date, first) / span) * innerW : 0), [first, span, innerW]);
  const y = (pct: number) => innerH - (pct / 100) * innerH;

  // Markers stay exactly on the sampled line.
  const keepKey = [today, projectEnd].filter((d): d is ISODate => d !== null).join("|");
  const sampled = React.useMemo(() => sampleSCurve(points, 400, keepKey ? keepKey.split("|") : []), [points, keepKey]);
  const line = sampled.map((p, i) => `${i === 0 ? "M" : "L"}${x(p.date).toFixed(1)},${y(p.percent).toFixed(1)}`).join("");
  const area = sampled.length > 0 ? `${line}L${x(sampled[sampled.length - 1].date).toFixed(1)},${innerH}L0,${innerH}Z` : "";

  const ticks = React.useMemo(() => xTicks(first, last, innerW, x), [first, last, innerW, x]);
  const inRange = (d: ISODate | null): d is ISODate => d !== null && !!first && !!last && d >= first && d <= last;
  const activePoint = active !== null ? points[active] : null;

  function indexFromClientX(clientX: number, rect: DOMRect): number {
    const px = clientX - rect.left - margin.left;
    const ratio = Math.min(1, Math.max(0, px / Math.max(1, innerW)));
    return Math.round(ratio * (points.length - 1));
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    const lastIndex = points.length - 1;
    const current = active ?? Math.max(0, Math.min(lastIndex, first ? diffDays(today, first) : 0));
    const step = event.shiftKey ? 7 : 1;
    let next: number | null = null;
    if (event.key === "ArrowRight") next = Math.min(lastIndex, current + step);
    else if (event.key === "ArrowLeft") next = Math.max(0, current - step);
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = lastIndex;
    else if (event.key === "Escape") setActive(null);
    if (next !== null) {
      event.preventDefault();
      setActive(next);
    }
  }

  const readout = activePoint
    ? `${formatDate(activePoint.date)}: planned ${formatPercent(activePoint.percent, { decimals: 1 })}${formatValue && total > 0 ? ` (${formatValue(activePoint.value)})` : ""}; actual not recorded yet.`
    : "";
  const readoutLeft = activePoint ? margin.left + x(activePoint.date) : 0;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-[13px] leading-5 text-muted-foreground">
        <span className="inline-flex items-center gap-2">
          <svg aria-hidden width="22" height="6" className="shrink-0">
            <line x1="0" y1="3" x2="22" y2="3" stroke="var(--chart-planned)" strokeWidth="2.5" strokeDasharray="5 3" />
          </svg>
          Planned ({baselineLabel})
        </span>
        <span className="inline-flex items-center gap-2">
          <svg aria-hidden width="22" height="6" className="shrink-0 opacity-40">
            <line x1="0" y1="3" x2="22" y2="3" stroke="var(--chart-actual)" strokeWidth="2.5" />
          </svg>
          Actual (no progress recorded yet)
        </span>
      </div>

      <div
        ref={wrapRef}
        tabIndex={0}
        role="group"
        aria-label="S-curve chart. Use the left and right arrow keys to read the planned value for each day; hold Shift to move by a week."
        aria-describedby="scurve-readout"
        onKeyDown={onKeyDown}
        onBlur={() => setActive(null)}
        className="relative rounded-md focus-ring"
        style={{ height }}
        data-testid="scurve-chart"
      >
        <p id="scurve-readout" className="sr-only" aria-live="polite">
          {readout}
        </p>
        {width > 0 && first ? (
          <svg
            aria-hidden
            width={width}
            height={height}
            className="block touch-pan-y select-none"
            onPointerMove={(event) => setActive(indexFromClientX(event.clientX, event.currentTarget.getBoundingClientRect()))}
            onPointerDown={(event) => setActive(indexFromClientX(event.clientX, event.currentTarget.getBoundingClientRect()))}
            onPointerLeave={(event) => {
              if (event.pointerType === "mouse") setActive(null);
            }}
          >
            <g transform={`translate(${margin.left},${margin.top})`}>
              {inRange(overrun?.start ?? null) && overrun ? (
                <rect
                  data-testid="scurve-overrun"
                  x={x(overrun.start)}
                  y={0}
                  width={Math.max(1, x(overrun.end) - x(overrun.start) + innerW / span)}
                  height={innerH}
                  fill="var(--chart-overrun)"
                />
              ) : null}
              {[0, 25, 50, 75, 100].map((pct) => (
                <g key={pct}>
                  <line x1={0} x2={innerW} y1={y(pct)} y2={y(pct)} stroke="var(--chart-gridline)" />
                  <text x={-8} y={y(pct)} dy="0.32em" textAnchor="end" className="fill-muted-foreground text-[11px] tabular-nums">
                    {pct}%
                  </text>
                  {formatValueShort && !narrow && total > 0 ? (
                    <text x={innerW + 8} y={y(pct)} dy="0.32em" className="fill-muted-foreground text-[11px] tabular-nums">
                      {formatValueShort((pct / 100) * total)}
                    </text>
                  ) : null}
                </g>
              ))}
              {ticks.map((t) => (
                <text key={t.date} x={t.x} y={innerH + 20} textAnchor="middle" className="fill-muted-foreground text-[11px]">
                  {t.label}
                </text>
              ))}
              <path d={area} fill="var(--chart-planned)" opacity={0.07} />
              <path
                d={line}
                fill="none"
                stroke="var(--chart-planned)"
                strokeWidth={2.5}
                strokeDasharray="7 4"
                strokeLinejoin="round"
                data-testid="scurve-planned"
              />
              {inRange(projectEnd) ? (
                <g>
                  <line x1={x(projectEnd)} x2={x(projectEnd)} y1={0} y2={innerH} stroke="var(--chart-end-marker)" strokeWidth={1.5} strokeDasharray="4 3" />
                  <text
                    x={x(projectEnd) - 4}
                    // Second line when the Today label would collide with it.
                    y={inRange(today) && Math.abs(x(today) - x(projectEnd)) < 90 ? 24 : 10}
                    textAnchor="end"
                    className="fill-chart-end-marker text-[10px] font-semibold"
                  >
                    Planned end
                  </text>
                </g>
              ) : null}
              {inRange(today) ? (
                <g>
                  <line x1={x(today)} x2={x(today)} y1={0} y2={innerH} stroke="var(--chart-today)" strokeWidth={2} />
                  <text x={x(today) + 4} y={10} className="fill-primary-text text-[10px] font-semibold">
                    Today
                  </text>
                </g>
              ) : null}
              {activePoint ? (
                <g>
                  <line x1={x(activePoint.date)} x2={x(activePoint.date)} y1={0} y2={innerH} stroke="var(--foreground)" strokeOpacity={0.35} />
                  <circle cx={x(activePoint.date)} cy={y(activePoint.percent)} r={4.5} fill="var(--surface)" stroke="var(--chart-planned)" strokeWidth={2.5} />
                </g>
              ) : null}
            </g>
          </svg>
        ) : (
          <div className="h-full animate-shimmer rounded-md bg-surface-sunken" />
        )}

        {activePoint ? (
          <div
            aria-hidden
            data-testid="scurve-readout"
            className="pointer-events-none absolute top-2 z-10 w-max max-w-[min(15rem,calc(100%-1rem))] rounded-md border border-border bg-surface px-3 py-2 text-xs leading-5 shadow-popover"
            style={{
              left: `clamp(0.5rem, ${readoutLeft}px - 7.5rem, calc(100% - min(15rem, 100% - 1rem) - 0.5rem))`,
            }}
          >
            <p className="font-semibold text-foreground">{formatDate(activePoint.date)}</p>
            <p className="flex justify-between gap-4 text-muted-foreground">
              Planned <span className="font-medium text-foreground tabular-nums">{formatPercent(activePoint.percent, { decimals: 1 })}</span>
            </p>
            {formatValue && total > 0 ? (
              <p className="flex justify-between gap-4 text-muted-foreground">
                <span />
                <span className="tabular-nums">{formatValue(activePoint.value)}</span>
              </p>
            ) : null}
            <p className={cn("flex justify-between gap-4 text-muted-foreground")}>
              Actual <span className="tabular-nums">—</span>
            </p>
          </div>
        ) : null}
      </div>
    </div>
  );
}

/** Month ticks (or Mondays for short ranges), thinned so labels are ≥ 56 px apart. */
function xTicks(
  first: ISODate | undefined,
  last: ISODate | undefined,
  innerW: number,
  x: (date: ISODate) => number,
): { date: ISODate; x: number; label: string }[] {
  if (!first || !last || innerW <= 0) return [];
  const days = diffDays(last, first);
  const out: { date: ISODate; x: number; label: string }[] = [];
  if (days <= 62) {
    let d = first;
    while (new Date(`${d}T00:00:00Z`).getUTCDay() !== 1) d = addDays(d, 1);
    for (; d <= last; d = addDays(d, 7)) out.push({ date: d, x: x(d), label: formatDayMonth(d) });
  } else {
    const start = new Date(`${first}T00:00:00Z`);
    let y = start.getUTCFullYear();
    let m = start.getUTCMonth() + (start.getUTCDate() === 1 ? 0 : 1);
    for (;;) {
      if (m > 11) {
        m -= 12;
        y += 1;
      }
      const d = new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 10);
      if (d > last) break;
      out.push({ date: d, x: x(d), label: m === 0 ? `${MONTHS[m]} ${y}` : MONTHS[m] });
      m += 1;
    }
  }
  const minGap = 56;
  const kept: typeof out = [];
  for (const t of out) if (kept.length === 0 || t.x - kept[kept.length - 1].x >= minGap) kept.push(t);
  return kept;
}
