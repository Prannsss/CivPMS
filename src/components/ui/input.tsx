"use client";

import { cn } from "@/lib/utils";
import { controlClasses } from "./control-classes";
import { useFieldControlProps } from "./field";

export type InputProps = React.ComponentProps<"input"> & {
  /** Decorative icon or prefix inside the left edge (e.g. a search icon or ₱). */
  leading?: React.ReactNode;
  /** Icon or small interactive element inside the right edge (e.g. a clear button). */
  trailing?: React.ReactNode;
  /** Force the invalid style (normally derived from the surrounding <Field error>). */
  invalid?: boolean;
  wrapperClassName?: string;
};

export function Input({
  className,
  wrapperClassName,
  leading,
  trailing,
  type = "text",
  ...props
}: InputProps) {
  const controlProps = useFieldControlProps(props);
  const input = (
    <input
      type={type}
      data-slot="input"
      className={cn(
        controlClasses,
        "h-11 px-3.5 sm:h-10",
        "file:mr-3 file:h-full file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground",
        leading ? "pl-10" : null,
        trailing ? "pr-11" : null,
        className,
      )}
      {...controlProps}
    />
  );

  if (!leading && !trailing) return input;

  return (
    <div className={cn("relative flex w-full items-center", wrapperClassName)}>
      {leading ? (
        <span className="pointer-events-none absolute left-3.5 flex items-center text-muted-foreground [&_svg:not([class*='size-'])]:size-4">
          {leading}
        </span>
      ) : null}
      {input}
      {trailing ? (
        <span className="absolute right-1 flex items-center text-muted-foreground [&_svg:not([class*='size-'])]:size-4">
          {trailing}
        </span>
      ) : null}
    </div>
  );
}
