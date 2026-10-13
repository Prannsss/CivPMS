import { PROJECT_COLOR_KEYS, type ProjectColorKey } from "@/lib/constants";
import { cn } from "@/lib/utils";
import { getProjectInitials } from "./initials";

export type ProjectColorStyle = {
  label: string;
  /** Solid fill (avatars, swatches). White text passes AA. */
  solid: string;
  /** Diagonal gradient for project cards (deeper at the bottom-right where text sits). */
  gradient: string;
  /** Ring color in the same hue (selected swatch outline). */
  ring: string;
};

/** Static class names so Tailwind can see them. Keys come from PROJECT_COLOR_KEYS. */
export const PROJECT_COLORS: Record<ProjectColorKey, ProjectColorStyle> = {
  blue: {
    label: "Blue",
    solid: "bg-project-blue",
    gradient: "bg-linear-to-br from-project-blue to-project-blue-to",
    ring: "ring-project-blue",
  },
  green: {
    label: "Green",
    solid: "bg-project-green",
    gradient: "bg-linear-to-br from-project-green to-project-green-to",
    ring: "ring-project-green",
  },
  pink: {
    label: "Pink",
    solid: "bg-project-pink",
    gradient: "bg-linear-to-br from-project-pink to-project-pink-to",
    ring: "ring-project-pink",
  },
  purple: {
    label: "Purple",
    solid: "bg-project-purple",
    gradient: "bg-linear-to-br from-project-purple to-project-purple-to",
    ring: "ring-project-purple",
  },
  teal: {
    label: "Teal",
    solid: "bg-project-teal",
    gradient: "bg-linear-to-br from-project-teal to-project-teal-to",
    ring: "ring-project-teal",
  },
  graphite: {
    label: "Graphite",
    solid: "bg-project-graphite",
    gradient: "bg-linear-to-br from-project-graphite to-project-graphite-to",
    ring: "ring-project-graphite",
  },
};

export function isProjectColorKey(value: string): value is ProjectColorKey {
  return (PROJECT_COLOR_KEYS as readonly string[]).includes(value);
}

/** Falls back to blue for unknown/legacy values. */
export function getProjectColor(key: string | null | undefined): ProjectColorStyle {
  return key && isProjectColorKey(key) ? PROJECT_COLORS[key] : PROJECT_COLORS.blue;
}

const avatarSizes = {
  sm: "size-8 text-xs",
  md: "size-10 text-sm",
  lg: "size-12 text-base",
  xl: "size-14 text-lg",
} as const;

export type ProjectAvatarProps = Omit<React.ComponentProps<"span">, "children" | "color"> & {
  name: string;
  color?: string | null;
  size?: keyof typeof avatarSizes;
};

/** Colored circle with project initials (sidebar header, lists, command palette). */
export function ProjectAvatar({ name, color, size = "md", className, ...props }: ProjectAvatarProps) {
  return (
    <span
      aria-hidden
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-full font-semibold tracking-tight text-white select-none",
        getProjectColor(color).gradient,
        avatarSizes[size],
        className,
      )}
      {...props}
    >
      {getProjectInitials(name)}
    </span>
  );
}
