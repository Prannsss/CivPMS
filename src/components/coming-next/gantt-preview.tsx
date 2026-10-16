import { cn } from "@/lib/utils";

/**
 * Decorative sketch of the Phase 2 Gantt chart (rendered aria-hidden by ComingNext): WBS rows,
 * summary bars with progress, status colors, a today line and a hatched overrun on a delayed bar.
 * Token colors only.
 */

type Tone = "success" | "info" | "danger" | "orange" | "neutral";

type Row = {
  code: string;
  name: string;
  start: number;
  end: number;
  tone?: Tone;
  /** Summary bar (parent) with a progress fill 0–100. */
  summary?: number;
  /** Overrun from the planned end to today (derived Delayed). */
  overrunTo?: number;
};

const TODAY = 57;

const ROWS: Row[] = [
  { code: "1", name: "Site preparation", start: 0, end: 24, summary: 100 },
  { code: "1.1", name: "Mobilization", start: 0, end: 11, tone: "success" },
  { code: "1.2", name: "Clearing and grubbing", start: 9, end: 24, tone: "success" },
  { code: "2", name: "Earthworks and drainage", start: 20, end: 66, summary: 46 },
  { code: "2.1", name: "Roadway excavation", start: 20, end: 42, tone: "info" },
  { code: "2.2", name: "RC pipe culverts", start: 31, end: 49, tone: "danger", overrunTo: TODAY },
  { code: "2.3", name: "Lined canal", start: 45, end: 66, tone: "orange" },
  { code: "3", name: "Pavement works", start: 60, end: 100, summary: 0 },
  { code: "3.1", name: "Aggregate base course", start: 60, end: 80, tone: "neutral" },
  { code: "3.2", name: "Concrete pavement", start: 76, end: 100, tone: "neutral" },
];

const MONTHS = ["Oct", "Nov", "Dec", "Jan", "Feb", "Mar"];

const TONE_FILL: Record<Tone, string> = {
  success: "bg-success",
  info: "bg-info",
  danger: "bg-danger",
  orange: "bg-orange",
  neutral: "bg-neutral/70",
};

const LEGEND: { tone: Tone; label: string }[] = [
  { tone: "success", label: "Completed" },
  { tone: "info", label: "Ongoing" },
  { tone: "danger", label: "Delayed" },
  { tone: "orange", label: "On-Hold" },
  { tone: "neutral", label: "Not Started" },
];

const OVERRUN_HATCH: React.CSSProperties = {
  backgroundImage: "repeating-linear-gradient(135deg, var(--danger) 0 3px, transparent 3px 7px)",
};

export function GanttPreview() {
  return (
    <div className="flex h-full flex-col overflow-hidden rounded-lg border border-border bg-surface shadow-sm">
      {/* Toolbar */}
      <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2.5">
        <div className="flex rounded-full bg-surface-sunken p-0.5 text-[10px] font-medium text-muted-foreground sm:text-[11px]">
          {["Day", "Week", "Month", "Quarter"].map((zoom) => (
            <span
              key={zoom}
              className={cn("rounded-full px-2 py-0.5 sm:px-2.5", zoom === "Month" && "bg-surface text-foreground shadow-xs")}
            >
              {zoom}
            </span>
          ))}
        </div>
        <span className="rounded-full border border-border px-2.5 py-0.5 text-[10px] font-medium text-muted-foreground sm:text-[11px]">
          Fit to project
        </span>
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-[7.5rem_minmax(0,1fr)] grid-rows-[auto_minmax(0,1fr)] sm:grid-cols-[11rem_minmax(0,1fr)]">
        {/* Grid header */}
        <div className="border-r border-b border-border px-3 py-1.5 text-[10px] font-medium text-muted-foreground">WBS</div>
        <div className="grid grid-cols-6 border-b border-border text-[10px] font-medium text-muted-foreground">
          {MONTHS.map((month) => (
            <span key={month} className="border-l border-border px-1.5 py-1.5 first:border-l-0">
              {month}
            </span>
          ))}
        </div>

        {/* Rows */}
        <div className="flex flex-col border-r border-border py-1">
          {ROWS.map((row) => (
            <div key={row.code} className="flex h-7 min-w-0 items-center gap-1.5 px-3 text-[11px] leading-4">
              <span className="w-6 shrink-0 font-mono text-[10px] text-muted-foreground tabular-nums">{row.code}</span>
              <span className={cn("truncate text-foreground", row.summary !== undefined && "font-semibold")}>{row.name}</span>
            </div>
          ))}
        </div>
        <div className="relative py-1">
          {/* Month columns + weekend-ish shading */}
          <div className="pointer-events-none absolute inset-0 grid grid-cols-6">
            {MONTHS.map((month, index) => (
              <span key={month} className={cn("border-l border-border first:border-l-0", index % 2 === 1 && "bg-surface-muted")} />
            ))}
          </div>
          {/* Today line */}
          <div className="pointer-events-none absolute inset-y-0 z-10 w-px bg-primary" style={{ left: `${TODAY}%` }}>
            <span className="absolute -top-0.5 left-1/2 -translate-x-1/2 rounded-full bg-primary px-1.5 text-[9px] leading-3.5 font-semibold text-primary-foreground">
              Today
            </span>
          </div>
          {ROWS.map((row) => (
            <div key={row.code} className="relative h-7">
              {row.summary !== undefined ? (
                <div
                  className="absolute top-1/2 h-2.5 -translate-y-1/2 overflow-hidden rounded-[3px] bg-foreground/15"
                  style={{ left: `${row.start}%`, width: `${row.end - row.start}%` }}
                >
                  <div className="h-full bg-foreground/70" style={{ width: `${row.summary}%` }} />
                </div>
              ) : (
                <>
                  <div
                    className={cn("absolute top-1/2 h-4 -translate-y-1/2 rounded-[4px] shadow-xs", TONE_FILL[row.tone ?? "neutral"])}
                    style={{ left: `${row.start}%`, width: `${row.end - row.start}%` }}
                  />
                  {row.overrunTo !== undefined ? (
                    <div
                      className="absolute top-1/2 h-4 -translate-y-1/2 rounded-r-[4px] border border-danger/60 opacity-80"
                      style={{ left: `${row.end}%`, width: `${row.overrunTo - row.end}%`, ...OVERRUN_HATCH }}
                    />
                  ) : null}
                </>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Legend */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-border px-3 py-2 text-[10px] text-muted-foreground sm:text-[11px]">
        {LEGEND.map((item) => (
          <span key={item.tone} className="inline-flex items-center gap-1.5">
            <span className={cn("size-2 rounded-full", TONE_FILL[item.tone])} />
            {item.label}
          </span>
        ))}
      </div>
    </div>
  );
}
