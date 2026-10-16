"use client";

import { cva, type VariantProps } from "class-variance-authority";
import { Dialog as SheetPrimitive } from "radix-ui";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

export const Sheet = SheetPrimitive.Root;
export const SheetTrigger = SheetPrimitive.Trigger;
export const SheetClose = SheetPrimitive.Close;

const sheetVariants = cva("fixed z-50 flex flex-col bg-surface text-foreground shadow-lg outline-none", {
  variants: {
    side: {
      right:
        "inset-y-0 right-0 h-dvh w-[min(26rem,calc(100%-2.5rem))] border-l border-border data-[state=open]:animate-sheet-in-right data-[state=closed]:animate-sheet-out-right",
      left: "inset-y-0 left-0 h-dvh w-[min(20rem,calc(100%-3.5rem))] border-r border-border data-[state=open]:animate-sheet-in-left data-[state=closed]:animate-sheet-out-left",
      bottom:
        "inset-x-0 bottom-0 max-h-[92dvh] rounded-t-2xl border-t border-border pb-[env(safe-area-inset-bottom)] data-[state=open]:animate-sheet-in-bottom data-[state=closed]:animate-sheet-out-bottom",
      top: "inset-x-0 top-0 max-h-[92dvh] rounded-b-2xl border-b border-border data-[state=open]:animate-sheet-in-top data-[state=closed]:animate-sheet-out-top",
    },
  },
  defaultVariants: { side: "right" },
});

export type SheetContentProps = React.ComponentProps<typeof SheetPrimitive.Content> &
  VariantProps<typeof sheetVariants> & {
    showClose?: boolean;
    /** Extra classes for the × button (e.g. to recolor it on a tinted sheet). */
    closeClassName?: string;
  };

/** Side drawer (filters, details, mobile navigation). Esc and outside click close it. */
export function SheetContent({
  side,
  className,
  children,
  showClose = true,
  closeClassName,
  ...props
}: SheetContentProps) {
  return (
    <SheetPrimitive.Portal>
      <SheetPrimitive.Overlay className="fixed inset-0 z-50 bg-overlay backdrop-blur-[2px] data-[state=open]:animate-fade-in data-[state=closed]:animate-fade-out" />
      <SheetPrimitive.Content data-slot="sheet-content" className={cn(sheetVariants({ side }), className)} {...props}>
        {children}
        {showClose ? (
          <SheetPrimitive.Close
            aria-label="Close"
            className={cn(
              "absolute top-3 right-3 inline-flex size-10 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-surface-sunken hover:text-foreground focus-ring",
              closeClassName,
            )}
          >
            <X aria-hidden className="size-[18px]" />
          </SheetPrimitive.Close>
        ) : null}
      </SheetPrimitive.Content>
    </SheetPrimitive.Portal>
  );
}

export function SheetHeader({ className, ...props }: React.ComponentProps<"div">) {
  return <div className={cn("flex shrink-0 flex-col gap-1 border-b border-border px-5 py-4 pr-14", className)} {...props} />;
}

export function SheetTitle({ className, ...props }: React.ComponentProps<typeof SheetPrimitive.Title>) {
  return (
    <SheetPrimitive.Title
      className={cn("text-lg leading-[1.625rem] font-semibold tracking-[-0.01em] text-foreground", className)}
      {...props}
    />
  );
}

export function SheetDescription({ className, ...props }: React.ComponentProps<typeof SheetPrimitive.Description>) {
  return <SheetPrimitive.Description className={cn("text-sm text-muted-foreground", className)} {...props} />;
}

export function SheetBody({ className, ...props }: React.ComponentProps<"div">) {
  return <div className={cn("min-h-0 flex-1 overflow-y-auto px-5 py-4", className)} {...props} />;
}

export function SheetFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      className={cn(
        "flex shrink-0 flex-col-reverse gap-2 border-t border-border bg-surface-muted px-5 py-4 sm:flex-row sm:justify-end",
        className,
      )}
      {...props}
    />
  );
}
