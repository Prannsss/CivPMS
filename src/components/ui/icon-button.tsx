import { cva, type VariantProps } from "class-variance-authority";
import { Slot } from "radix-ui";
import { cn } from "@/lib/utils";
import { Spinner } from "./spinner";
import { SimpleTooltip } from "./tooltip";

export const iconButtonVariants = cva(
  [
    "relative inline-flex shrink-0 items-center justify-center rounded-full select-none",
    "transition-[background-color,border-color,color,transform] duration-150 ease-out focus-ring active:scale-95",
    "disabled:pointer-events-none disabled:opacity-50",
    "[&_svg]:pointer-events-none [&_svg]:shrink-0",
  ],
  {
    variants: {
      variant: {
        /** Filled neutral circle — the mockup header buttons. */
        soft: "bg-surface-sunken text-foreground hover:bg-border active:bg-border-strong",
        ghost: "text-muted-foreground hover:bg-surface-sunken hover:text-foreground",
        outline:
          "border border-border-strong bg-surface text-foreground hover:border-input hover:bg-surface-muted",
        primary: "bg-primary text-primary-foreground hover:bg-primary-hover active:bg-primary-active",
        danger: "text-danger-text hover:bg-danger-soft",
      },
      size: {
        sm: "size-9 [&_svg:not([class*='size-'])]:size-4",
        md: "size-11 [&_svg:not([class*='size-'])]:size-5 sm:size-10",
        lg: "size-12 [&_svg:not([class*='size-'])]:size-5",
      },
    },
    defaultVariants: { variant: "soft", size: "md" },
  },
);

export type IconButtonProps = Omit<React.ComponentProps<"button">, "aria-label"> &
  VariantProps<typeof iconButtonVariants> & {
    /** Required accessible name; also shown as the tooltip. */
    "aria-label": string;
    /** Tooltip text (defaults to aria-label). Pass `false` to disable the tooltip. */
    tooltip?: React.ReactNode | false;
    tooltipSide?: "top" | "right" | "bottom" | "left";
    asChild?: boolean;
    loading?: boolean;
  };

/** Round icon-only button with a required label and tooltip (mockups 6–8 header circles). */
export function IconButton({
  className,
  variant,
  size,
  tooltip,
  tooltipSide = "bottom",
  asChild = false,
  loading = false,
  disabled,
  children,
  type,
  ...props
}: IconButtonProps) {
  const Comp = asChild ? Slot.Root : "button";
  const button = (
    <Comp
      data-slot="icon-button"
      className={cn(iconButtonVariants({ variant, size }), className)}
      disabled={asChild ? undefined : disabled || loading}
      aria-busy={loading || undefined}
      type={asChild ? undefined : (type ?? "button")}
      {...props}
    >
      {loading ? <Spinner size="sm" label={null} /> : <Slot.Slottable>{children}</Slot.Slottable>}
    </Comp>
  );
  if (tooltip === false) return button;
  return (
    <SimpleTooltip content={tooltip ?? props["aria-label"]} side={tooltipSide}>
      {button}
    </SimpleTooltip>
  );
}
