import { cn } from "@/lib/utils";

export type CardProps = React.ComponentProps<"div"> & {
  /** `interactive` adds hover elevation for clickable cards (wrap content in a link). */
  variant?: "default" | "muted" | "interactive";
};

export function Card({ className, variant = "default", ...props }: CardProps) {
  return (
    <div
      data-slot="card"
      className={cn(
        "flex min-w-0 flex-col rounded-lg border border-border text-foreground",
        variant === "muted" ? "bg-surface-muted" : "bg-surface shadow-xs",
        variant === "interactive" &&
          "transition-[box-shadow,border-color,transform] duration-150 ease-out hover:-translate-y-0.5 hover:border-border-strong hover:shadow-md",
        className,
      )}
      {...props}
    />
  );
}

export function CardHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      className={cn(
        "grid auto-rows-min grid-cols-[1fr_auto] items-start gap-x-4 gap-y-1 px-5 pt-5 sm:px-6 sm:pt-6 has-[+[data-card-footer]]:pb-5",
        className,
      )}
      {...props}
    />
  );
}

export function CardTitle({ className, ...props }: React.ComponentProps<"h3">) {
  return (
    <h3
      className={cn("col-start-1 text-base leading-6 font-semibold tracking-[-0.01em] text-foreground", className)}
      {...props}
    />
  );
}

export function CardDescription({ className, ...props }: React.ComponentProps<"p">) {
  return <p className={cn("col-start-1 text-[13px] leading-5 text-muted-foreground", className)} {...props} />;
}

/** Top-right slot of the header (menu button, link). */
export function CardAction({ className, ...props }: React.ComponentProps<"div">) {
  return <div className={cn("col-start-2 row-span-2 row-start-1 self-start justify-self-end", className)} {...props} />;
}

export function CardContent({ className, ...props }: React.ComponentProps<"div">) {
  return <div className={cn("px-5 py-5 sm:px-6", className)} {...props} />;
}

export function CardFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-card-footer=""
      className={cn(
        "mt-auto flex items-center gap-3 rounded-b-lg border-t border-border bg-surface-muted px-5 py-3.5 sm:px-6",
        className,
      )}
      {...props}
    />
  );
}
