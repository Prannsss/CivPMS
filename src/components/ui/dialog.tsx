"use client";

import { Dialog as DialogPrimitive } from "radix-ui";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogClose = DialogPrimitive.Close;
export const DialogPortal = DialogPrimitive.Portal;

export function DialogOverlay({ className, ...props }: React.ComponentProps<typeof DialogPrimitive.Overlay>) {
  return (
    <DialogPrimitive.Overlay
      className={cn(
        "fixed inset-0 z-50 bg-overlay backdrop-blur-[2px]",
        "data-[state=open]:animate-fade-in data-[state=closed]:animate-fade-out",
        className,
      )}
      {...props}
    />
  );
}

const dialogSizes = {
  sm: "sm:max-w-sm",
  md: "sm:max-w-lg",
  lg: "sm:max-w-2xl",
  xl: "sm:max-w-4xl",
} as const;

export type DialogSize = keyof typeof dialogSizes;

export type DialogContentProps = React.ComponentProps<typeof DialogPrimitive.Content> & {
  size?: DialogSize;
  /** Show the × button in the top-right corner. */
  showClose?: boolean;
};

/**
 * Modal surface. Centered card on ≥640px; bottom sheet with a grab handle on phones.
 * Compose with DialogHeader / DialogBody / DialogFooter.
 */
export function DialogContent({ className, children, size = "md", showClose = true, ...props }: DialogContentProps) {
  return (
    <DialogPortal>
      <DialogOverlay />
      <DialogPrimitive.Content
        data-slot="dialog-content"
        className={cn(
          "fixed z-50 flex flex-col bg-surface text-foreground shadow-lg outline-none",
          // phone: bottom sheet
          "inset-x-0 bottom-0 max-h-[92dvh] rounded-t-2xl border-t border-border pb-[env(safe-area-inset-bottom)]",
          "data-[state=open]:animate-sheet-in-bottom data-[state=closed]:animate-sheet-out-bottom",
          // ≥ sm: centered card
          "sm:inset-x-auto sm:bottom-auto sm:top-1/2 sm:left-1/2 sm:max-h-[min(85dvh,52rem)] sm:w-[calc(100%-2rem)] sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-xl sm:border sm:pb-0",
          "sm:data-[state=open]:animate-pop-in sm:data-[state=closed]:animate-pop-out",
          dialogSizes[size],
          className,
        )}
        {...props}
      >
        <div aria-hidden className="mx-auto mt-2.5 h-1 w-10 shrink-0 rounded-full bg-border-strong sm:hidden" />
        {children}
        {showClose ? (
          <DialogPrimitive.Close
            className="absolute top-3 right-3 inline-flex size-10 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-surface-sunken hover:text-foreground focus-ring sm:top-4 sm:right-4 sm:size-9"
            aria-label="Close"
          >
            <X aria-hidden className="size-[18px]" />
          </DialogPrimitive.Close>
        ) : null}
      </DialogPrimitive.Content>
    </DialogPortal>
  );
}

export function DialogHeader({ className, ...props }: React.ComponentProps<"div">) {
  return <div className={cn("flex shrink-0 flex-col gap-1.5 px-5 pt-4 pb-2 pr-14 sm:px-6 sm:pt-6", className)} {...props} />;
}

export function DialogTitle({ className, ...props }: React.ComponentProps<typeof DialogPrimitive.Title>) {
  return (
    <DialogPrimitive.Title
      className={cn("text-lg leading-[1.625rem] font-semibold tracking-[-0.01em] text-foreground", className)}
      {...props}
    />
  );
}

export function DialogDescription({ className, ...props }: React.ComponentProps<typeof DialogPrimitive.Description>) {
  return <DialogPrimitive.Description className={cn("text-sm leading-[1.375rem] text-muted-foreground", className)} {...props} />;
}

/** Scrollable middle section. */
export function DialogBody({ className, ...props }: React.ComponentProps<"div">) {
  return <div className={cn("min-h-0 flex-1 overflow-y-auto px-5 py-4 sm:px-6", className)} {...props} />;
}

/** Action row. Stacks full-width on phones with the primary action on top. */
export function DialogFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      className={cn(
        "flex shrink-0 flex-col-reverse gap-2 border-t border-border bg-surface-muted px-5 py-4 sm:flex-row sm:items-center sm:justify-end sm:rounded-b-xl sm:px-6",
        "[&>button]:w-full sm:[&>button]:w-auto",
        className,
      )}
      {...props}
    />
  );
}

export type ModalProps = {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Optional element that opens the modal (rendered with asChild). */
  trigger?: React.ReactElement;
  title: React.ReactNode;
  description?: React.ReactNode;
  footer?: React.ReactNode;
  size?: DialogSize;
  children?: React.ReactNode;
  className?: string;
  /** Prevent closing on outside click (use for forms with unsaved input). */
  dismissible?: boolean;
};

/** Convenience wrapper: header + scrollable body + footer in one component. */
export function Modal({
  open,
  onOpenChange,
  trigger,
  title,
  description,
  footer,
  size = "md",
  children,
  className,
  dismissible = true,
}: ModalProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {trigger ? <DialogTrigger asChild>{trigger}</DialogTrigger> : null}
      <DialogContent
        size={size}
        className={className}
        onInteractOutside={dismissible ? undefined : (event) => event.preventDefault()}
        {...(description ? {} : { "aria-describedby": undefined })}
      >
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description ? <DialogDescription>{description}</DialogDescription> : null}
        </DialogHeader>
        {children ? <DialogBody>{children}</DialogBody> : null}
        {footer ? <DialogFooter>{footer}</DialogFooter> : null}
      </DialogContent>
    </Dialog>
  );
}
