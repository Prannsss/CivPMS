import { LoaderCircle } from "lucide-react";
import { cn } from "@/lib/utils";

type SpinnerProps = Omit<React.ComponentProps<"span">, "children"> & {
  size?: "xs" | "sm" | "md" | "lg";
  /** Accessible label. Pass `null` when a parent already announces the busy state. */
  label?: string | null;
};

const sizes = { xs: "size-3.5", sm: "size-4", md: "size-5", lg: "size-8" } as const;

/** Indeterminate spinner for in-place busy states. Prefer skeletons for page loads. */
export function Spinner({ size = "sm", label = "Loading", className, ...props }: SpinnerProps) {
  return (
    <span
      role={label ? "status" : undefined}
      className={cn("inline-flex shrink-0 items-center justify-center", className)}
      {...props}
    >
      <LoaderCircle aria-hidden className={cn("animate-spin", sizes[size])} />
      {label ? <span className="sr-only">{label}</span> : null}
    </span>
  );
}
