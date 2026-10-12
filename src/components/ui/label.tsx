"use client";

import { Label as LabelPrimitive } from "radix-ui";
import { cn } from "@/lib/utils";

type LabelProps = React.ComponentProps<typeof LabelPrimitive.Root> & {
  /** Shows a red asterisk (announced as "required"). */
  required?: boolean;
};

export function Label({ className, required, children, ...props }: LabelProps) {
  return (
    <LabelPrimitive.Root
      className={cn(
        "inline-flex items-center gap-1 text-[13px] leading-5 font-medium text-foreground select-none",
        "peer-disabled:cursor-not-allowed peer-disabled:opacity-60",
        className,
      )}
      {...props}
    >
      {children}
      {required ? (
        <>
          <span className="text-danger-text" aria-hidden>
            *
          </span>
          <span className="sr-only">(required)</span>
        </>
      ) : null}
    </LabelPrimitive.Root>
  );
}
