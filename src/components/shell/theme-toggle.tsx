"use client";

import { useSyncExternalStore } from "react";
import { Monitor, Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { IconButton } from "@/components/ui/icon-button";
import { SegmentedControl } from "@/components/ui/segmented-control";

export type ThemeChoice = "light" | "dark" | "system";

export const THEME_OPTIONS = [
  { value: "light", label: "Light", icon: <Sun /> },
  { value: "dark", label: "Dark", icon: <Moon /> },
  { value: "system", label: "System", icon: <Monitor /> },
] as const satisfies ReadonlyArray<{ value: ThemeChoice; label: string; icon: React.ReactNode }>;

const noopSubscribe = () => () => {};

/** true after hydration — the stored theme is only known on the client. */
export function useMounted(): boolean {
  return useSyncExternalStore(noopSubscribe, () => true, () => false);
}

export function useThemeChoice(): [ThemeChoice, (value: ThemeChoice) => void] {
  const { theme, setTheme } = useTheme();
  const mounted = useMounted();
  const value: ThemeChoice = mounted && (theme === "light" || theme === "dark") ? theme : "system";
  return [value, setTheme];
}

export type ThemeToggleProps = {
  /** `menu`: round icon button with a Light/Dark/System menu (top bar). `segmented`: inline control (settings). */
  variant?: "menu" | "segmented";
  className?: string;
};

export function ThemeToggle({ variant = "menu", className }: ThemeToggleProps) {
  const [value, setValue] = useThemeChoice();

  if (variant === "segmented") {
    return (
      <SegmentedControl
        aria-label="Theme"
        options={THEME_OPTIONS}
        value={value}
        onValueChange={setValue}
        className={className}
      />
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <IconButton aria-label="Change theme" tooltip="Theme" variant="soft" className={className}>
          <Sun aria-hidden className="dark:hidden" />
          <Moon aria-hidden className="hidden dark:block" />
        </IconButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-44">
        <DropdownMenuLabel>Theme</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={value} onValueChange={(next) => setValue(next as ThemeChoice)}>
          {THEME_OPTIONS.map((option) => (
            <DropdownMenuRadioItem key={option.value} value={option.value}>
              {option.icon}
              {option.label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
