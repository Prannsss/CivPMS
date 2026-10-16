import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

export const BADGE_TONES = ["neutral", "primary", "info", "success", "warning", "orange", "danger"] as const;
export type BadgeTone = (typeof BADGE_TONES)[number];

const toneStyles: Record<BadgeTone, { soft: string; solid: string; outline: string; dot: string }> = {
  neutral: {
    soft: "bg-neutral-soft text-neutral-text",
    solid: "bg-neutral text-neutral-foreground",
    outline: "border-border-strong text-neutral-text",
    dot: "bg-neutral",
  },
  primary: {
    soft: "bg-primary-soft text-primary-text",
    solid: "bg-primary text-primary-foreground",
    outline: "border-primary/45 text-primary-text",
    dot: "bg-primary",
  },
  info: {
    soft: "bg-info-soft text-info-text",
    solid: "bg-info text-info-foreground",
    outline: "border-info/50 text-info-text",
    dot: "bg-info",
  },
  success: {
    soft: "bg-success-soft text-success-text",
    solid: "bg-success text-success-foreground",
    outline: "border-success/50 text-success-text",
    dot: "bg-success",
  },
  warning: {
    soft: "bg-warning-soft text-warning-text",
    solid: "bg-warning text-warning-foreground",
    outline: "border-warning/60 text-warning-text",
    dot: "bg-warning",
  },
  orange: {
    soft: "bg-orange-soft text-orange-text",
    solid: "bg-orange text-orange-foreground",
    outline: "border-orange/50 text-orange-text",
    dot: "bg-orange",
  },
  danger: {
    soft: "bg-danger-soft text-danger-text",
    solid: "bg-danger text-danger-foreground",
    outline: "border-danger/45 text-danger-text",
    dot: "bg-danger",
  },
};

export const badgeVariants = cva(
  "inline-flex max-w-full shrink-0 items-center gap-1 rounded-full border font-medium whitespace-nowrap [&_svg]:shrink-0",
  {
    variants: {
      variant: { soft: "border-transparent", solid: "border-transparent", outline: "bg-transparent" },
      tone: Object.fromEntries(BADGE_TONES.map((t) => [t, ""])) as Record<BadgeTone, string>,
      size: {
        sm: "h-5 px-2 text-[11px] leading-4 [&_svg:not([class*='size-'])]:size-3",
        md: "h-6 px-2.5 text-xs leading-4 [&_svg:not([class*='size-'])]:size-3.5",
        lg: "h-7 px-3 text-[13px] leading-5 [&_svg:not([class*='size-'])]:size-4",
      },
    },
    compoundVariants: BADGE_TONES.flatMap((tone) =>
      (["soft", "solid", "outline"] as const).map((variant) => ({
        tone,
        variant,
        className: toneStyles[tone][variant],
      })),
    ),
    defaultVariants: { variant: "soft", tone: "neutral", size: "md" },
  },
);

export type BadgeProps = React.ComponentProps<"span"> &
  VariantProps<typeof badgeVariants> & {
    /** Leading icon (lucide). */
    icon?: React.ReactNode;
    /** Small colored dot instead of an icon. */
    dot?: boolean;
  };

export function Badge({ className, variant, tone, size, icon, dot, children, ...props }: BadgeProps) {
  return (
    <span data-slot="badge" className={cn(badgeVariants({ variant, tone, size }), className)} {...props}>
      {dot ? (
        <span
          aria-hidden
          className={cn(
            "size-1.5 rounded-full",
            variant === "solid" ? "bg-current" : toneStyles[tone ?? "neutral"].dot,
          )}
        />
      ) : null}
      {icon ? <span aria-hidden className="-ml-0.5 inline-flex">{icon}</span> : null}
      <span className="truncate">{children}</span>
    </span>
  );
}
