import { cn } from "@/lib/utils";

/**
 * Decorative sketch of the Phase 3 S-curve (rendered aria-hidden by ComingNext): planned line
 * from the baseline, actual line to today, variance readout and the Cost | Hours toggle.
 * Token colors only.
 */

const X0 = 40;
const X1 = 388;
const Y0 = 200;
const Y1 = 16;
const TODAY_X = 250;

const PLANNED = `M ${X0} ${Y0 - 1} C 118 197, 150 172, 200 112 S 300 22, ${X1} ${Y1 + 2}`;
const ACTUAL = `M ${X0} ${Y0 - 0.5} C 112 198, 152 184, 192 146 S 236 104, ${TODAY_X} 98`;
const ACTUAL_AREA = `${ACTUAL} L ${TODAY_X} ${Y0} L ${X0} ${Y0} Z`;

const Y_TICKS = [0, 25, 50, 75, 100];
const MONTHS = ["Oct", "Dec", "Feb", "Apr", "Jun", "Aug"];

function yFor(percent: number): number {
  return Y0 - ((Y0 - Y1) * percent) / 100;
}

export function SCurvePreview() {
  return (
    <div className="flex h-full flex-col overflow-hidden rounded-lg border border-border bg-surface shadow-sm">
      <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2.5">
        <div className="flex items-center gap-3 text-[10px] font-medium text-muted-foreground sm:text-[11px]">
          <span className="inline-flex items-center gap-1.5">
            <span className="h-0 w-4 border-t-2 border-dashed border-muted-foreground" />
            Planned
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="h-[3px] w-4 rounded-full bg-primary" />
            Actual
          </span>
        </div>
        <div className="flex rounded-full bg-surface-sunken p-0.5 text-[10px] font-medium text-muted-foreground sm:text-[11px]">
          {["Cost", "Hours"].map((basis) => (
            <span key={basis} className={cn("rounded-full px-2.5 py-0.5", basis === "Cost" && "bg-surface text-foreground shadow-xs")}>
              {basis}
            </span>
          ))}
        </div>
      </div>

      <div className="relative min-h-0 flex-1 p-2 sm:p-3">
        <svg viewBox="0 0 400 228" className="h-full w-full" preserveAspectRatio="xMidYMid meet" role="presentation">
          {Y_TICKS.map((tick) => (
            <g key={tick}>
              <line x1={X0} x2={X1} y1={yFor(tick)} y2={yFor(tick)} className="stroke-border" strokeWidth={1} />
              <text x={X0 - 8} y={yFor(tick) + 3.5} textAnchor="end" className="fill-muted-foreground text-[10px] tabular-nums">
                {tick}%
              </text>
            </g>
          ))}
          {MONTHS.map((month, index) => {
            const x = X0 + ((X1 - X0) * index) / (MONTHS.length - 1);
            return (
              <text key={month} x={x} y={Y0 + 18} textAnchor="middle" className="fill-muted-foreground text-[10px]">
                {month}
              </text>
            );
          })}
          <path d={ACTUAL_AREA} className="fill-primary-soft" opacity={0.9} />
          <path d={PLANNED} fill="none" className="stroke-muted-foreground" strokeWidth={2} strokeDasharray="6 5" strokeLinecap="round" />
          <path d={ACTUAL} fill="none" className="stroke-primary" strokeWidth={3} strokeLinecap="round" />
          <line x1={TODAY_X} x2={TODAY_X} y1={Y1 - 4} y2={Y0} className="stroke-primary" strokeWidth={1} strokeDasharray="3 3" />
          <circle cx={TODAY_X} cy={98} r={5} className="fill-primary stroke-surface" strokeWidth={2} />
          <circle cx={TODAY_X} cy={68} r={4} className="fill-surface stroke-muted-foreground" strokeWidth={2} />
        </svg>

        {/* Variance readout (hover tooltip in the real chart) */}
        <div className="absolute top-[14%] left-[66%] hidden w-36 flex-col gap-1 rounded-md border border-border bg-surface p-2.5 text-[11px] leading-4 shadow-popover sm:flex">
          <span className="font-semibold text-foreground">12 Feb 2027</span>
          <span className="flex justify-between text-muted-foreground">
            Planned <span className="font-medium text-foreground tabular-nums">64%</span>
          </span>
          <span className="flex justify-between text-muted-foreground">
            Actual <span className="font-medium text-foreground tabular-nums">48%</span>
          </span>
          <span className="flex justify-between text-danger-text">
            Variance <span className="font-semibold tabular-nums">−16 pts</span>
          </span>
        </div>
      </div>
    </div>
  );
}
