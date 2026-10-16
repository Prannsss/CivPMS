import { cn } from "@/lib/utils";

/** Keyboard key hint, e.g. <Kbd>⌘</Kbd><Kbd>K</Kbd>. */
export function Kbd({ className, ...props }: React.ComponentProps<"kbd">) {
  return (
    <kbd
      className={cn(
        "inline-flex h-5 min-w-5 items-center justify-center rounded-xs border border-border-strong bg-surface px-1 font-sans text-[11px] leading-none font-medium text-muted-foreground",
        className,
      )}
      {...props}
    />
  );
}
