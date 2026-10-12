"use client";

import { useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import { cn } from "@/lib/utils";
import { Input, type InputProps } from "./input";

export type PasswordInputProps = Omit<InputProps, "type" | "trailing">;

/** Password input with an accessible show/hide toggle. */
export function PasswordInput({ className, autoComplete = "current-password", ...props }: PasswordInputProps) {
  const [visible, setVisible] = useState(false);
  return (
    <Input
      type={visible ? "text" : "password"}
      autoComplete={autoComplete}
      spellCheck={false}
      autoCapitalize="none"
      className={cn("tracking-normal", className)}
      trailing={
        <button
          type="button"
          onClick={() => setVisible((v) => !v)}
          aria-label={visible ? "Hide password" : "Show password"}
          aria-pressed={visible}
          disabled={props.disabled}
          className="inline-flex size-9 items-center justify-center rounded-sm text-muted-foreground transition-colors hover:bg-surface-sunken hover:text-foreground focus-ring disabled:pointer-events-none sm:size-8"
        >
          {visible ? <EyeOff aria-hidden className="size-4" /> : <Eye aria-hidden className="size-4" />}
        </button>
      }
      {...props}
    />
  );
}
