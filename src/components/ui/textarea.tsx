"use client";

import { cn } from "@/lib/utils";
import { useFieldControlProps } from "./field";
import { controlClasses } from "./control-classes";

export type TextareaProps = React.ComponentProps<"textarea"> & { invalid?: boolean };

export function Textarea({ className, rows = 4, ...props }: TextareaProps) {
  const controlProps = useFieldControlProps(props);
  return (
    <textarea
      data-slot="textarea"
      rows={rows}
      className={cn(controlClasses, "field-sizing-content min-h-24 resize-y px-3.5 py-2.5 leading-[1.375rem]", className)}
      {...controlProps}
    />
  );
}
