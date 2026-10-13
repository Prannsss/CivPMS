import { cva, type VariantProps } from "class-variance-authority";
import { Slot } from "radix-ui";
import { cn } from "@/lib/utils";
import { Spinner } from "./spinner";

export const buttonVariants = cva(
  [
    "relative inline-flex shrink-0 items-center justify-center gap-2 rounded-md font-medium whitespace-nowrap select-none",
    "transition-[background-color,border-color,color,box-shadow,transform] duration-150 ease-out",
    "focus-ring active:translate-y-px",
    "disabled:pointer-events-none aria-disabled:pointer-events-none",
    "[&:disabled:not([aria-busy])]:opacity-50 [&[aria-disabled=true]:not([aria-busy])]:opacity-50",
    "[&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  ],
  {
    variants: {
      variant: {
        primary:
          "bg-primary text-primary-foreground shadow-xs hover:bg-primary-hover active:bg-primary-active",
        secondary: "bg-surface-sunken text-foreground hover:bg-border active:bg-border-strong",
        outline:
          "border border-border-strong bg-surface text-foreground shadow-xs hover:border-input hover:bg-surface-muted active:bg-surface-sunken",
        ghost: "text-foreground hover:bg-surface-sunken active:bg-border",
        danger:
          "bg-danger text-danger-foreground shadow-xs hover:bg-danger-hover active:bg-danger-hover",
        "danger-outline":
          "border border-danger/45 bg-surface text-danger-text hover:border-danger hover:bg-danger-soft",
        link: "h-auto rounded-xs px-0 text-primary-text underline-offset-4 hover:underline active:translate-y-0",
      },
      size: {
        sm: "h-9 px-3 text-[13px] leading-5",
        md: "h-11 px-4 text-sm leading-5 sm:h-10",
        lg: "h-12 px-6 text-[15px] leading-6",
        icon: "size-11 sm:size-10",
        "icon-sm": "size-9",
      },
    },
    compoundVariants: [{ variant: "link", className: "h-auto px-0 sm:h-auto" }],
    defaultVariants: { variant: "primary", size: "md" },
  },
);

export type ButtonVariant = NonNullable<VariantProps<typeof buttonVariants>["variant"]>;
export type ButtonSize = NonNullable<VariantProps<typeof buttonVariants>["size"]>;

export type ButtonProps = React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    /** Render the single child (e.g. a Next <Link>) with button styles. */
    asChild?: boolean;
    /** Shows a spinner, sets aria-busy and blocks clicks while keeping the label visible. */
    loading?: boolean;
    /** Optional text announced/shown while loading, e.g. "Saving…". */
    loadingText?: string;
  };

export function Button({
  className,
  variant,
  size,
  asChild = false,
  loading = false,
  loadingText,
  disabled,
  children,
  type,
  ...props
}: ButtonProps) {
  const Comp = asChild ? Slot.Root : "button";
  return (
    <Comp
      data-slot="button"
      className={cn(buttonVariants({ variant, size }), loading && "cursor-wait", className)}
      disabled={asChild ? undefined : disabled || loading}
      aria-disabled={asChild && (disabled || loading) ? true : undefined}
      aria-busy={loading || undefined}
      type={asChild ? undefined : (type ?? "button")}
      {...props}
    >
      {loading ? <Spinner size="sm" label={null} /> : null}
      <Slot.Slottable>{loading && loadingText ? loadingText : children}</Slot.Slottable>
    </Comp>
  );
}
