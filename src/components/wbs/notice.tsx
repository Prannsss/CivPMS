import { Info, Lock, TriangleAlert } from "lucide-react";
import { cn } from "@/lib/utils";

export type NoticeTone = "info" | "warning" | "danger" | "neutral";

const tones: Record<NoticeTone, { box: string; icon: string; Icon: typeof Info }> = {
  info: { box: "border-primary/25 bg-primary-soft/60", icon: "text-primary-text", Icon: Info },
  warning: { box: "border-warning/40 bg-warning-soft/70", icon: "text-warning-text", Icon: TriangleAlert },
  danger: { box: "border-danger/30 bg-danger-soft/70", icon: "text-danger-text", Icon: TriangleAlert },
  neutral: { box: "border-border bg-surface-muted", icon: "text-muted-foreground", Icon: Lock },
};

export type NoticeProps = Omit<React.ComponentProps<"div">, "title"> & {
  tone?: NoticeTone;
  title: React.ReactNode;
  icon?: React.ReactNode;
  action?: React.ReactNode;
};

/**
 * Inline, non-blocking page notice (read-only reasons, soft warnings such as "warn, don't block"
 * budget overruns, spec §6.4 / §17.2). Always icon + text, never color alone.
 */
export function Notice({ tone = "info", title, icon, action, className, children, ...props }: NoticeProps) {
  const t = tones[tone];
  const Icon = t.Icon;
  return (
    <div
      role={tone === "danger" || tone === "warning" ? "status" : undefined}
      className={cn(
        "flex flex-col gap-3 rounded-lg border px-4 py-3 sm:flex-row sm:items-center sm:gap-4",
        t.box,
        className,
      )}
      {...props}
    >
      <div className="flex min-w-0 flex-1 items-start gap-3">
        <span aria-hidden className={cn("mt-0.5 shrink-0 [&_svg]:size-[18px]", t.icon)}>
          {icon ?? <Icon />}
        </span>
        <div className="flex min-w-0 flex-col gap-0.5">
          <p className="text-sm leading-5 font-medium text-foreground">{title}</p>
          {children ? <div className="text-[13px] leading-5 text-pretty text-muted-foreground">{children}</div> : null}
        </div>
      </div>
      {action ? <div className="flex shrink-0 items-center gap-2 pl-8 sm:pl-0">{action}</div> : null}
    </div>
  );
}
