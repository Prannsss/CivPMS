"use client";

import * as React from "react";
import { Tooltip as TooltipPrimitive } from "radix-ui";
import { cn } from "@/lib/utils";

export function TooltipProvider({
  delayDuration = 300,
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Provider>) {
  return <TooltipPrimitive.Provider delayDuration={delayDuration} {...props} />;
}

export const Tooltip = TooltipPrimitive.Root;
export const TooltipTrigger = TooltipPrimitive.Trigger;

export function TooltipContent({
  className,
  sideOffset = 6,
  collisionPadding = 8,
  children,
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Content>) {
  return (
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Content
        sideOffset={sideOffset}
        collisionPadding={collisionPadding}
        className={cn(
          "z-50 max-w-[min(20rem,var(--radix-tooltip-content-available-width))] rounded-sm bg-inverse px-2.5 py-1.5 text-xs leading-4 font-medium text-inverse-foreground shadow-popover",
          // Grows from the trigger on first show; moving between tooltips (instant-open) only fades.
          "origin-(--radix-tooltip-content-transform-origin) data-[state=closed]:animate-fade-out data-[state=delayed-open]:animate-pop-in data-[state=instant-open]:animate-fade-in",
          className,
        )}
        {...props}
      >
        {children}
      </TooltipPrimitive.Content>
    </TooltipPrimitive.Portal>
  );
}

type SimpleTooltipProps = {
  content: React.ReactNode;
  children: React.ReactElement;
  side?: React.ComponentProps<typeof TooltipPrimitive.Content>["side"];
  align?: React.ComponentProps<typeof TooltipPrimitive.Content>["align"];
  /** Render the trigger without a tooltip (e.g. when the label is already visible). */
  disabled?: boolean;
};

/** One-line tooltip around any focusable element. */
export function SimpleTooltip({ content, children, side = "top", align, disabled }: SimpleTooltipProps) {
  if (disabled) return children;
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent side={side} align={align}>
        {content}
      </TooltipContent>
    </Tooltip>
  );
}

type TruncatedTextProps = Omit<React.ComponentProps<"span">, "children"> & {
  children: string;
  side?: React.ComponentProps<typeof TooltipPrimitive.Content>["side"];
};

/**
 * Text that is cut off with an ellipsis (`truncate` / `line-clamp-*` in `className`). The full text
 * shows in an edge-safe tooltip on hover, but only while it is actually cut off.
 */
export function TruncatedText({ children, className, side = "top", ...props }: TruncatedTextProps) {
  const ref = React.useRef<HTMLSpanElement>(null);
  const [open, setOpen] = React.useState(false);
  return (
    <Tooltip
      open={open}
      onOpenChange={(next) => {
        const el = ref.current;
        setOpen(next && !!el && (el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1));
      }}
    >
      <TooltipTrigger asChild>
        <span ref={ref} className={cn("min-w-0", className)} {...props}>
          {children}
        </span>
      </TooltipTrigger>
      <TooltipContent side={side} className="break-words">
        {children}
      </TooltipContent>
    </Tooltip>
  );
}
