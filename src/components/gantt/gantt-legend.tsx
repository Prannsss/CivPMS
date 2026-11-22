import { STATUS_META } from "@/components/ui/status-badge";
import { ACTIVITY_STATUSES } from "@/lib/domain";
import { cn } from "@/lib/utils";
import { BAR_TONES, OVERDUE_HATCH } from "./bar-tones";

/** What every mark on the chart means (colour is always paired with an icon or a pattern). */
export function GanttLegend() {
  return (
    <div className="flex flex-col gap-3 text-[13px] leading-5">
      <p className="text-label">Legend</p>
      <ul className="grid gap-2">
        {ACTIVITY_STATUSES.map((status) => {
          const meta = STATUS_META[status];
          const Icon = meta.icon;
          return (
            <li key={status} className="flex items-center gap-2.5">
              <span aria-hidden className={cn("h-3.5 w-8 shrink-0 rounded-[4px] border-[1.5px]", BAR_TONES[status].bar)} />
              <Icon aria-hidden className={cn("size-4 shrink-0", BAR_TONES[status].text)} strokeWidth={2.25} />
              {meta.label}
            </li>
          );
        })}
        <li className="flex items-center gap-2.5">
          <span aria-hidden className={cn("h-3.5 w-8 shrink-0 rounded-r-[4px]", OVERDUE_HATCH)} />
          Past its end date, not finished (up to today)
        </li>
        <li className="flex items-center gap-2.5">
          <span aria-hidden className="relative h-3 w-8 shrink-0">
            <span className="absolute inset-x-0 top-0 h-[7px] rounded-[2px] bg-chart-summary" />
          </span>
          Deliverable or sub-deliverable (summary)
        </li>
        <li className="flex items-center gap-2.5">
          <span aria-hidden className="grid w-8 shrink-0 place-items-center">
            <span className="size-3 rotate-45 rounded-[2px] border-[1.5px] border-neutral-text/70 bg-neutral-soft" />
          </span>
          Milestone (zero duration)
        </li>
        <li className="flex items-center gap-2.5">
          <span aria-hidden className="h-1 w-8 shrink-0 rounded-full bg-chart-baseline/80" />
          Baseline dates (when shown)
        </li>
        <li className="flex items-center gap-2.5">
          <span aria-hidden className="grid w-8 shrink-0 place-items-center">
            <span className="h-4 w-0.5 bg-chart-today" />
          </span>
          Today
        </li>
        <li className="flex items-center gap-2.5">
          <span aria-hidden className="grid w-8 shrink-0 place-items-center">
            <span className="h-4 border-l-2 border-dashed border-chart-end-marker" />
          </span>
          Planned project end
        </li>
        <li className="flex items-center gap-2.5">
          <span aria-hidden className="h-3.5 w-8 shrink-0 rounded-[3px] bg-chart-overrun ring-1 ring-danger/20" />
          Overrun past the planned end
        </li>
        <li className="flex items-center gap-2.5">
          <span aria-hidden className="h-3.5 w-8 shrink-0 rounded-[3px] bg-chart-nonworking ring-1 ring-border" />
          Weekends, holidays and non-working days
        </li>
      </ul>
    </div>
  );
}
