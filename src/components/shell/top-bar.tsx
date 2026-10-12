"use client";

import { useEffect, useState } from "react";
import { Menu, Search } from "lucide-react";
import { IconButton } from "@/components/ui/icon-button";
import { Kbd } from "@/components/ui/kbd";
import { cn } from "@/lib/utils";
import { useModifierKeyLabel } from "./command-palette";
import { NotificationBell, type NotificationBellProps } from "./notification-bell";
import { ThemeToggle } from "./theme-toggle";
import { UserMenu, type UserMenuProps } from "./user-menu";

export type TopBarProps = {
  /** Left slot: greeting + company (home), breadcrumb or page title (project). */
  leading?: React.ReactNode;
  /** Opens the command palette. Omit to hide the search trigger. */
  onSearchClick?: () => void;
  searchPlaceholder?: string;
  notifications?: NotificationBellProps;
  user?: UserMenuProps;
  showThemeToggle?: boolean;
  /** Extra buttons placed before the theme toggle. */
  actions?: React.ReactNode;
  /** Shows a hamburger button below `lg` (opens the project sidebar sheet). */
  onMenuClick?: () => void;
  /** Stick to the top and gain a blurred background + border once the page scrolls. */
  sticky?: boolean;
  className?: string;
  /** Classes for the inner row (e.g. max width to align with page content). */
  innerClassName?: string;
};

function useScrolled(threshold = 4): boolean {
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > threshold);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, [threshold]);
  return scrolled;
}

/** App header (mockups 6–8): leading slot, centered pill search, theme/bell/avatar cluster. */
export function TopBar({
  leading,
  onSearchClick,
  searchPlaceholder = "Search projects, activities, people…",
  notifications,
  user,
  showThemeToggle = true,
  actions,
  onMenuClick,
  sticky = true,
  className,
  innerClassName,
}: TopBarProps) {
  const scrolled = useScrolled();
  const modifier = useModifierKeyLabel();

  return (
    <header
      data-scrolled={scrolled || undefined}
      className={cn(
        "z-40 w-full border-b border-transparent bg-background transition-[background-color,border-color,box-shadow] duration-200",
        sticky && "sticky top-0",
        sticky &&
          "data-[scrolled]:border-border data-[scrolled]:bg-background/80 data-[scrolled]:shadow-xs data-[scrolled]:backdrop-blur-md data-[scrolled]:backdrop-saturate-150",
        className,
      )}
    >
      <div
        className={cn(
          "flex h-16 items-center gap-2 px-4 sm:gap-3 sm:px-6 lg:grid lg:h-20 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)_minmax(max-content,1fr)] lg:gap-6 lg:px-8",
          innerClassName,
        )}
      >
        <div className="flex min-w-0 flex-1 items-center gap-2 lg:flex-none">
          {onMenuClick ? (
            <IconButton aria-label="Open navigation" tooltip={false} variant="ghost" onClick={onMenuClick} className="-ml-2 lg:hidden">
              <Menu aria-hidden />
            </IconButton>
          ) : null}
          <div className="min-w-0 flex-1">{leading}</div>
        </div>

        {onSearchClick ? (
          <button
            type="button"
            onClick={onSearchClick}
            aria-label="Search"
            aria-keyshortcuts="Control+K Meta+K"
            className={cn(
              "group hidden h-12 w-full max-w-xl items-center gap-3 justify-self-center rounded-full border border-transparent bg-surface-sunken pr-2.5 pl-5 text-left text-sm text-muted-foreground lg:flex",
              "transition-[border-color,background-color,box-shadow] duration-150 hover:border-border-strong hover:bg-surface focus-ring",
            )}
          >
            <Search aria-hidden className="size-[18px] shrink-0" />
            <span className="min-w-0 flex-1 truncate">{searchPlaceholder}</span>
            <span aria-hidden className="flex shrink-0 items-center gap-1">
              <Kbd className="h-6 min-w-6 bg-surface px-1.5 text-xs">{modifier}</Kbd>
              <Kbd className="h-6 min-w-6 bg-surface px-1.5 text-xs">K</Kbd>
            </span>
          </button>
        ) : (
          <div className="hidden lg:block" />
        )}

        <div className="flex shrink-0 items-center justify-end gap-1.5 sm:gap-2.5">
          {onSearchClick ? (
            <IconButton aria-label="Search" variant="ghost" onClick={onSearchClick} className="lg:hidden">
              <Search aria-hidden />
            </IconButton>
          ) : null}
          {actions}
          {showThemeToggle ? <ThemeToggle className="hidden sm:inline-flex" /> : null}
          {notifications ? <NotificationBell {...notifications} /> : null}
          {user ? <UserMenu {...user} className={cn("ml-1", user.className)} /> : null}
        </div>
      </div>
    </header>
  );
}

export type TopBarGreetingProps = {
  /** Small line above, e.g. "Welcome back". */
  eyebrow?: React.ReactNode;
  title: React.ReactNode;
  /** Visual before the text (company logo or project avatar). */
  leading?: React.ReactNode;
  className?: string;
};

/** Two-line heading for the top bar's left slot ("Welcome back" / "Juan Dela Cruz"). */
export function TopBarGreeting({ eyebrow, title, leading, className }: TopBarGreetingProps) {
  return (
    <div className={cn("flex min-w-0 items-center gap-3", className)}>
      {leading ? <div className="shrink-0">{leading}</div> : null}
      <div className="flex min-w-0 flex-col">
        {eyebrow ? <span className="truncate text-xs leading-4 font-medium text-muted-foreground sm:text-[13px] sm:leading-5">{eyebrow}</span> : null}
        <span className="truncate text-base leading-6 font-semibold tracking-[-0.01em] text-foreground sm:text-lg sm:leading-7">
          {title}
        </span>
      </div>
    </div>
  );
}
