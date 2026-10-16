import Image from "next/image";
import { APP_NAME } from "@/lib/constants";
import { cn } from "@/lib/utils";

const sizes = {
  sm: { mark: 24, text: "text-[15px] leading-5" },
  md: { mark: 32, text: "text-lg leading-6" },
  lg: { mark: 44, text: "text-2xl leading-8" },
} as const;

export type LogoProps = Omit<React.ComponentProps<"span">, "children"> & {
  /** `color` on light/dark surfaces, `white` on the blue sidebar/auth panel. */
  variant?: "color" | "white";
  size?: keyof typeof sizes;
  /** Only the mark (collapsed sidebar, favicon-like spots). */
  markOnly?: boolean;
  /** Load eagerly (above-the-fold logos). */
  priority?: boolean;
};

/** CivPMS mark + wordmark. The wordmark's "PMS" picks up the brand blue in the color variant. */
export function Logo({ variant = "color", size = "md", markOnly = false, priority = false, className, ...props }: LogoProps) {
  const s = sizes[size];
  const src = variant === "white" ? "/brand/logo-mark-white.png" : "/brand/logo-mark.png";
  return (
    <span className={cn("inline-flex items-center gap-2 select-none", className)} {...props}>
      <Image
        src={src}
        alt={markOnly ? APP_NAME : ""}
        width={s.mark}
        height={s.mark}
        priority={priority}
        className={cn("shrink-0", variant === "color" && "dark:brightness-110")}
      />
      {markOnly ? null : (
        <span
          className={cn(
            "font-bold tracking-[-0.03em]",
            s.text,
            variant === "white" ? "text-white" : "text-foreground",
          )}
        >
          Civ<span className={variant === "white" ? "text-white" : "text-primary-text"}>PMS</span>
        </span>
      )}
    </span>
  );
}
