"use client";

import { useState, useSyncExternalStore } from "react";
import { Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { IconButton } from "@/components/ui/icon-button";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { cn } from "@/lib/utils";

/** Two themes only: a click switches between them (no "System" choice). */
export type ThemeChoice = "light" | "dark";

export const THEME_OPTIONS = [
  { value: "light", label: "Light", icon: <Sun /> },
  { value: "dark", label: "Dark", icon: <Moon /> },
] as const satisfies ReadonlyArray<{ value: ThemeChoice; label: string; icon: React.ReactNode }>;

const noopSubscribe = () => () => {};

/** true after hydration — the stored theme is only known on the client. */
export function useMounted(): boolean {
  return useSyncExternalStore(noopSubscribe, () => true, () => false);
}

/**
 * The theme on screen and a setter that always stores an explicit light/dark choice. Until the
 * person picks one, the very first visit shows the device's setting (`resolvedTheme`).
 */
export function useThemeChoice(): { theme: ThemeChoice; mounted: boolean; setTheme: (value: ThemeChoice) => void; toggle: () => void } {
  const { resolvedTheme, setTheme } = useTheme();
  const mounted = useMounted();
  const theme: ThemeChoice = mounted && resolvedTheme === "dark" ? "dark" : "light";
  return { theme, mounted, setTheme, toggle: () => setTheme(theme === "dark" ? "light" : "dark") };
}

export type ThemeToggleProps = {
  /** `button`: round icon button that flips the theme on click (top bar). `segmented`: Light | Dark (settings). */
  variant?: "button" | "segmented";
  className?: string;
};

export function ThemeToggle({ variant = "button", className }: ThemeToggleProps) {
  const { theme, mounted, setTheme, toggle } = useThemeChoice();
  // Bumped on every click so the icon re-mounts and plays its spin. A keyframe animation, not a
  // transition: next-themes turns transitions off for the frame in which the theme changes.
  const [spins, setSpins] = useState(0);

  if (variant === "segmented") {
    return (
      <SegmentedControl
        aria-label="Theme"
        options={THEME_OPTIONS}
        value={theme}
        onValueChange={setTheme}
        className={className}
      />
    );
  }

  const isDark = theme === "dark";
  return (
    <IconButton
      aria-label="Dark mode"
      aria-pressed={mounted ? isDark : undefined}
      tooltip={isDark ? "Switch to light mode" : "Switch to dark mode"}
      variant="soft"
      className={className}
      onClick={() => {
        toggle();
        setSpins((n) => n + 1);
      }}
    >
      <span key={spins} aria-hidden className={cn("inline-flex", spins > 0 && "animate-theme-spin")}>
        <Sun className="dark:hidden" />
        <Moon className="hidden dark:block" />
      </span>
    </IconButton>
  );
}
