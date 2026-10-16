"use client";

import { Avatar as AvatarPrimitive } from "radix-ui";
import { cn } from "@/lib/utils";
import { getInitials, hashToIndex } from "./initials";

const sizes = {
  xs: "size-6 text-[10px]",
  sm: "size-8 text-xs",
  md: "size-10 text-sm",
  lg: "size-12 text-base",
  xl: "size-16 text-xl",
} as const;

export type AvatarSize = keyof typeof sizes;

/** Soft tone pairs (all pass AA); picked deterministically from the name. */
const PALETTE = [
  "bg-primary-soft text-primary-text",
  "bg-info-soft text-info-text",
  "bg-success-soft text-success-text",
  "bg-warning-soft text-warning-text",
  "bg-orange-soft text-orange-text",
  "bg-neutral-soft text-neutral-text",
] as const;

export type AvatarProps = Omit<React.ComponentProps<typeof AvatarPrimitive.Root>, "children"> & {
  /** Person's display name — used for initials, color and alt text. */
  name: string;
  src?: string | null;
  size?: AvatarSize;
  /** Adds a ring that separates the avatar from what is behind it (groups, headers). */
  ring?: boolean;
};

export function Avatar({ name, src, size = "md", ring = false, className, ...props }: AvatarProps) {
  const color = PALETTE[hashToIndex(name, PALETTE.length)];
  return (
    <AvatarPrimitive.Root
      data-slot="avatar"
      className={cn(
        "relative inline-flex shrink-0 overflow-hidden rounded-full align-middle select-none",
        sizes[size],
        ring && "ring-2 ring-background",
        className,
      )}
      {...props}
    >
      {src ? (
        <AvatarPrimitive.Image src={src} alt={name} className="size-full object-cover" referrerPolicy="no-referrer" />
      ) : null}
      <AvatarPrimitive.Fallback
        delayMs={src ? 400 : 0}
        className={cn("flex size-full items-center justify-center font-semibold tracking-tight", color)}
      >
        <span aria-hidden>{getInitials(name)}</span>
        <span className="sr-only">{name}</span>
      </AvatarPrimitive.Fallback>
    </AvatarPrimitive.Root>
  );
}

export type AvatarGroupProps = {
  people: ReadonlyArray<{ name: string; src?: string | null }>;
  /** Maximum avatars before collapsing into "+N". */
  max?: number;
  size?: AvatarSize;
  className?: string;
};

export function AvatarGroup({ people, max = 4, size = "sm", className }: AvatarGroupProps) {
  const visible = people.slice(0, max);
  const rest = people.length - visible.length;
  return (
    <div className={cn("flex items-center -space-x-1.5", className)}>
      {visible.map((person, index) => (
        <Avatar key={`${person.name}-${index}`} name={person.name} src={person.src} size={size} ring />
      ))}
      {rest > 0 ? (
        <span
          className={cn(
            "relative inline-flex shrink-0 items-center justify-center rounded-full bg-surface-sunken font-semibold text-muted-foreground ring-2 ring-background",
            sizes[size],
          )}
          aria-label={`and ${rest} more`}
        >
          +{rest}
        </span>
      ) : null}
    </div>
  );
}
