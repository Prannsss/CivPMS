"use client";

import { CircleCheck, CircleX, Info, TriangleAlert, X } from "lucide-react";
import { Toaster as Sonner, toast as sonnerToast, type ExternalToast } from "sonner";
import { Spinner } from "./spinner";

/**
 * Snackbars. Mounted once in <Providers>. Bottom-right on desktop, full-width bottom on phones.
 * Toasts render inside a `.dark` scope, so they are a dark snackbar on the light theme and a
 * lifted dark-gray card on the dark theme — with the same AA-checked tokens in both.
 */
export function Toaster() {
  return (
    <Sonner
      // Our toasts are fully unstyled and always use the `.dark` token scope. Sonner's own dark theme
      // still paints the close button (white disc) even in unstyled mode, so its theme stays "light".
      theme="light"
      // A little wider than Sonner's 356px so a title + "Undo" fit on one line.
      style={{ "--width": "384px" } as React.CSSProperties}
      position="bottom-right"
      offset={24}
      mobileOffset={12}
      gap={10}
      visibleToasts={4}
      closeButton
      containerAriaLabel="Notifications"
      icons={{
        success: <CircleCheck className="size-5 text-success-text" aria-hidden />,
        error: <CircleX className="size-5 text-danger-text" aria-hidden />,
        warning: <TriangleAlert className="size-5 text-warning-text" aria-hidden />,
        info: <Info className="size-5 text-info-text" aria-hidden />,
        loading: <Spinner size="md" label={null} className="text-muted-foreground" />,
        close: <X className="size-4" aria-hidden />,
      }}
      toastOptions={{
        unstyled: true,
        classNames: {
          toast:
            "dark group/toast relative flex w-full items-start gap-3 rounded-lg border border-border-strong bg-surface-sunken p-4 pr-11 font-sans text-foreground shadow-lg sm:w-(--width)",
          icon: "mt-px flex size-5 shrink-0 items-center justify-center",
          content: "flex min-w-0 flex-1 flex-col gap-0.5",
          title: "text-sm leading-5 font-medium text-foreground",
          description: "text-[13px] leading-5 text-muted-foreground",
          actionButton:
            "-my-1 ml-1 inline-flex h-8 shrink-0 items-center rounded-sm px-2.5 text-[13px] font-semibold text-primary-text transition-colors hover:bg-border focus-ring",
          cancelButton:
            "-my-1 inline-flex h-8 shrink-0 items-center rounded-sm px-2.5 text-[13px] font-medium text-muted-foreground transition-colors hover:bg-border hover:text-foreground focus-ring",
          closeButton:
            "absolute top-3 right-3 inline-flex size-7 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-border hover:text-foreground focus-ring",
        },
      }}
    />
  );
}

export type ToastAction = { label: string; onClick: () => void };

export type ToastOptions = {
  description?: React.ReactNode;
  action?: ToastAction;
  /** Milliseconds; defaults to 4s (8s when an action is present). */
  duration?: number;
  id?: string | number;
};

function toSonner(options?: ToastOptions): ExternalToast {
  if (!options) return {};
  const { action, duration, ...rest } = options;
  return {
    ...rest,
    duration: duration ?? (action ? 8000 : undefined),
    action: action ? { label: action.label, onClick: () => action.onClick() } : undefined,
  };
}

type Message = React.ReactNode;

/**
 * Snackbar helpers.
 *
 * toast.success("Project created");
 * toast.error("Couldn't save", { description: "Check your connection and try again." });
 * toast.success("Deliverable moved", { action: { label: "Undo", onClick: undoMove } });
 * toast.undo("Work package deleted", () => restore(id));
 * toast.promise(save(), { loading: "Saving…", success: "Saved", error: "Couldn't save" });
 */
export const toast = {
  message: (title: Message, options?: ToastOptions) => sonnerToast.message(title, toSonner(options)),
  success: (title: Message, options?: ToastOptions) => sonnerToast.success(title, toSonner(options)),
  error: (title: Message, options?: ToastOptions) => sonnerToast.error(title, toSonner(options)),
  warning: (title: Message, options?: ToastOptions) => sonnerToast.warning(title, toSonner(options)),
  info: (title: Message, options?: ToastOptions) => sonnerToast.info(title, toSonner(options)),
  loading: (title: Message, options?: ToastOptions) => sonnerToast.loading(title, toSonner(options)),
  /** Reversible action feedback with an Undo button (8 s). */
  undo: (title: Message, onUndo: () => void, options?: Omit<ToastOptions, "action">) =>
    sonnerToast.success(title, toSonner({ ...options, action: { label: "Undo", onClick: onUndo } })),
  promise: sonnerToast.promise,
  dismiss: sonnerToast.dismiss,
};
