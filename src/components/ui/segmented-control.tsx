"use client";

import * as React from "react";
import { ToggleGroup } from "radix-ui";
import { cn } from "@/lib/utils";

export type SegmentedOption<T extends string> = {
  value: T;
  label: React.ReactNode;
  icon?: React.ReactNode;
  /** Hide the text label (icon-only); the label is still used as the accessible name. */
  iconOnly?: boolean;
  disabled?: boolean;
};

export type SegmentedControlProps<T extends string> = {
  options: ReadonlyArray<SegmentedOption<T>>;
  value: T;
  onValueChange: (value: T) => void;
  /** Accessible name of the group, e.g. "Duration unit". */
  "aria-label": string;
  size?: "sm" | "md";
  /** Stretch segments to fill the container. */
  fullWidth?: boolean;
  className?: string;
  disabled?: boolean;
};

/**
 * Single-choice pill switcher (Hours | Days, Graph | List, Light | Dark).
 * Always has exactly one selected value; arrow keys move between segments. The selected pill
 * slides to the chosen segment: until it has been measured (server render, first paint) the
 * selected segment draws its own background, so nothing flashes.
 */
export function SegmentedControl<T extends string>({
  options,
  value,
  onValueChange,
  size = "md",
  fullWidth = false,
  className,
  disabled,
  ...props
}: SegmentedControlProps<T>) {
  const rootRef = React.useRef<HTMLDivElement>(null);
  const [thumb, setThumb] = React.useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const [animate, setAnimate] = React.useState(false);

  React.useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const measure = () => {
      const item = root.querySelector<HTMLElement>('[data-segment][data-state="on"]');
      setThumb(item ? { x: item.offsetLeft, y: item.offsetTop, w: item.offsetWidth, h: item.offsetHeight } : null);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(root);
    return () => observer.disconnect();
  }, [value, options, size, fullWidth]);

  // Place the pill without motion first; slide only on later changes.
  React.useEffect(() => {
    if (!thumb || animate) return;
    const frame = requestAnimationFrame(() => setAnimate(true));
    return () => cancelAnimationFrame(frame);
  }, [thumb, animate]);

  return (
    <ToggleGroup.Root
      ref={rootRef}
      type="single"
      value={value}
      onValueChange={(next) => {
        // Radix allows deselecting; a segmented control always keeps one value.
        if (next) onValueChange(next as T);
      }}
      disabled={disabled}
      aria-label={props["aria-label"]}
      className={cn(
        "relative inline-flex items-center gap-0.5 rounded-full bg-surface-sunken p-1",
        fullWidth && "flex w-full",
        className,
      )}
    >
      {thumb ? (
        <span
          aria-hidden
          data-segment-thumb
          className={cn(
            "pointer-events-none absolute top-0 left-0 rounded-full bg-surface shadow-sm dark:bg-border-strong",
            animate && "transition-[translate,width,height] duration-300 ease-in-out",
          )}
          style={{ width: thumb.w, height: thumb.h, translate: `${thumb.x}px ${thumb.y}px` }}
        />
      ) : null}
      {options.map((option) => (
        <ToggleGroup.Item
          key={option.value}
          data-segment
          value={option.value}
          disabled={option.disabled}
          aria-label={option.iconOnly && typeof option.label === "string" ? option.label : undefined}
          className={cn(
            "relative z-[1] inline-flex items-center justify-center gap-1.5 rounded-full font-medium whitespace-nowrap text-muted-foreground",
            "transition-[background-color,color,box-shadow] duration-200 ease-in-out focus-ring",
            "hover:text-foreground",
            "data-[state=on]:text-foreground",
            !thumb && "data-[state=on]:bg-surface data-[state=on]:shadow-sm dark:data-[state=on]:bg-border-strong",
            "disabled:pointer-events-none disabled:opacity-50",
            "[&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
            size === "md" ? "h-9 px-3.5 text-[13px] sm:h-8" : "h-7 px-2.5 text-xs",
            option.iconOnly && (size === "md" ? "w-9 px-0 sm:w-8" : "w-7 px-0"),
            fullWidth && "flex-1",
          )}
        >
          {option.icon}
          {option.iconOnly ? null : <span>{option.label}</span>}
        </ToggleGroup.Item>
      ))}
    </ToggleGroup.Root>
  );
}
