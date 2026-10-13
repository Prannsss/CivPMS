"use client";

import { createContext, useCallback, useContext, useId, useMemo, useRef, useState } from "react";
import { AlertDialog as AlertDialogPrimitive } from "radix-ui";
import { CircleHelp, TriangleAlert } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "./button";
import { Input } from "./input";

export type ConfirmTone = "default" | "danger";

export type ConfirmOptions = {
  title: React.ReactNode;
  /** State the impact plainly, e.g. "Deletes 4 sub-deliverables and 11 work packages." */
  description?: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: ConfirmTone;
  /** When set, the user must type this exact text (e.g. the project name) to enable Confirm. */
  confirmText?: string;
  /** Override the leading icon (defaults to a warning triangle for danger). Pass null to hide it. */
  icon?: React.ReactNode | null;
};

export type ConfirmDialogProps = ConfirmOptions & {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
  onCancel?: () => void;
  /** Shows a spinner on the confirm button (declarative usage with async work). */
  loading?: boolean;
};

/** Declarative confirm dialog. Most code should use `useConfirm()` instead. */
export function ConfirmDialog({
  open,
  onOpenChange,
  onConfirm,
  onCancel,
  loading = false,
  title,
  description,
  confirmLabel,
  cancelLabel = "Cancel",
  tone = "default",
  confirmText,
  icon,
}: ConfirmDialogProps) {
  const [typed, setTyped] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const inputId = useId();
  const matches = !confirmText || typed.trim() === confirmText;
  const resolvedIcon =
    icon === null ? null : (icon ?? (tone === "danger" ? <TriangleAlert /> : confirmText ? <CircleHelp /> : null));
  const resolvedConfirmLabel = confirmLabel ?? (tone === "danger" ? "Delete" : "Confirm");

  return (
    <AlertDialogPrimitive.Root
      open={open}
      onOpenChange={(next) => {
        if (!next) setTyped("");
        onOpenChange(next);
      }}
    >
      <AlertDialogPrimitive.Portal>
        <AlertDialogPrimitive.Overlay className="fixed inset-0 z-50 bg-overlay backdrop-blur-[2px] data-[state=open]:animate-fade-in data-[state=closed]:animate-fade-out" />
        <AlertDialogPrimitive.Content
          onOpenAutoFocus={(event) => {
            if (confirmText) {
              event.preventDefault();
              inputRef.current?.focus();
            }
          }}
          className={cn(
            "fixed z-50 flex flex-col bg-surface text-foreground shadow-lg outline-none",
            "inset-x-0 bottom-0 rounded-t-2xl border-t border-border pb-[env(safe-area-inset-bottom)] data-[state=open]:animate-sheet-in-bottom data-[state=closed]:animate-sheet-out-bottom",
            "sm:inset-x-auto sm:bottom-auto sm:top-1/2 sm:left-1/2 sm:w-[calc(100%-2rem)] sm:max-w-md sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-xl sm:border sm:pb-0",
            "sm:data-[state=open]:animate-pop-in sm:data-[state=closed]:animate-pop-out",
          )}
        >
          <form
            onSubmit={(event) => {
              event.preventDefault();
              if (matches && !loading) onConfirm();
            }}
          >
            <div className="flex flex-col gap-4 px-5 pt-6 pb-5 sm:flex-row sm:px-6">
              {resolvedIcon ? (
                <span
                  aria-hidden
                  className={cn(
                    "grid size-11 shrink-0 place-items-center rounded-full [&_svg]:size-5",
                    tone === "danger" ? "bg-danger-soft text-danger-text" : "bg-primary-soft text-primary-text",
                  )}
                >
                  {resolvedIcon}
                </span>
              ) : null}
              <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                <AlertDialogPrimitive.Title className="text-lg leading-[1.625rem] font-semibold tracking-[-0.01em]">
                  {title}
                </AlertDialogPrimitive.Title>
                {description ? (
                  <AlertDialogPrimitive.Description className="text-sm leading-[1.375rem] text-muted-foreground">
                    {description}
                  </AlertDialogPrimitive.Description>
                ) : (
                  <AlertDialogPrimitive.Description className="sr-only">Please confirm.</AlertDialogPrimitive.Description>
                )}
                {confirmText ? (
                  <div className="mt-3 flex flex-col gap-1.5">
                    <label htmlFor={inputId} className="text-[13px] leading-5 text-foreground">
                      Type <strong className="font-semibold break-all">{confirmText}</strong> to confirm
                    </label>
                    <Input
                      ref={inputRef}
                      id={inputId}
                      value={typed}
                      onChange={(event) => setTyped(event.target.value)}
                      autoComplete="off"
                      spellCheck={false}
                      autoCapitalize="none"
                      placeholder={confirmText}
                    />
                  </div>
                ) : null}
              </div>
            </div>
            <div className="flex flex-col-reverse gap-2 border-t border-border bg-surface-muted px-5 py-4 sm:flex-row sm:justify-end sm:rounded-b-xl sm:px-6">
              <AlertDialogPrimitive.Cancel asChild>
                <Button variant="outline" onClick={onCancel} disabled={loading} className="w-full sm:w-auto">
                  {cancelLabel}
                </Button>
              </AlertDialogPrimitive.Cancel>
              <Button
                type="submit"
                variant={tone === "danger" ? "danger" : "primary"}
                disabled={!matches}
                loading={loading}
                className="w-full sm:w-auto"
              >
                {resolvedConfirmLabel}
              </Button>
            </div>
          </form>
        </AlertDialogPrimitive.Content>
      </AlertDialogPrimitive.Portal>
    </AlertDialogPrimitive.Root>
  );
}

type ConfirmFn = (options: ConfirmOptions) => Promise<boolean>;

const ConfirmContext = createContext<ConfirmFn | null>(null);

type PendingConfirm = { id: number; options: ConfirmOptions; resolve: (value: boolean) => void };

/** Mount once (in <Providers>). Enables `useConfirm()` anywhere below it. */
export function ConfirmProvider({ children }: { children: React.ReactNode }) {
  const [pending, setPending] = useState<PendingConfirm | null>(null);
  const [open, setOpen] = useState(false);
  const pendingRef = useRef<PendingConfirm | null>(null);
  const counterRef = useRef(0);

  const settle = useCallback((value: boolean) => {
    pendingRef.current?.resolve(value);
    pendingRef.current = null;
    setOpen(false);
  }, []);

  const confirm = useCallback<ConfirmFn>((options) => {
    // A new request supersedes an unanswered one (treated as cancelled).
    pendingRef.current?.resolve(false);
    return new Promise<boolean>((resolve) => {
      counterRef.current += 1;
      const next = { id: counterRef.current, options, resolve };
      pendingRef.current = next;
      setPending(next);
      setOpen(true);
    });
  }, []);

  const value = useMemo(() => confirm, [confirm]);

  return (
    <ConfirmContext.Provider value={value}>
      {children}
      {pending ? (
        <ConfirmDialog
          key={pending.id}
          {...pending.options}
          open={open}
          onOpenChange={(next) => {
            if (!next) settle(false);
          }}
          onConfirm={() => settle(true)}
        />
      ) : null}
    </ConfirmContext.Provider>
  );
}

/**
 * Ask the user to confirm an action. Resolves `true` on confirm, `false` on cancel/Esc/outside.
 *
 * const confirm = useConfirm();
 * if (await confirm({ title: "Delete deliverable?", description: "Deletes 4 sub-deliverables…",
 *   tone: "danger", confirmLabel: "Delete" })) { … }
 */
export function useConfirm(): ConfirmFn {
  const ctx = useContext(ConfirmContext);
  if (!ctx) throw new Error("useConfirm() must be used inside <ConfirmProvider> (see components/providers.tsx).");
  return ctx;
}
