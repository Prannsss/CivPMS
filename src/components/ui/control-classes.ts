import { cn } from "@/lib/utils";

/** Shared look of text-like form controls (input, textarea, select trigger). */
export const controlClasses = cn(
  "w-full min-w-0 rounded-md border border-input bg-surface text-sm text-foreground",
  "transition-[border-color,box-shadow,background-color] duration-150 ease-out",
  "placeholder:text-muted-foreground",
  "enabled:hover:border-muted-foreground",
  "outline-none focus-visible:border-primary focus-visible:ring-[3px] focus-visible:ring-primary/20",
  "aria-invalid:border-danger aria-invalid:enabled:hover:border-danger aria-invalid:focus-visible:ring-danger/20",
  "disabled:cursor-not-allowed disabled:border-border-strong disabled:bg-surface-sunken disabled:text-muted-foreground disabled:opacity-80",
  "read-only:bg-surface-muted",
);
