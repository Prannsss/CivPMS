"use client";

import { useRef } from "react";
import Link from "next/link";
import { LogOut, Monitor, Settings, SunMoon, UserRound } from "lucide-react";
import { Avatar } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { THEME_OPTIONS, useThemeChoice, type ThemeChoice } from "./theme-toggle";

/** Sign-out target: a POST form action (URL such as "/auth/signout" or a server action) or a callback. */
export type SignOutHandler =
  | { action: string | ((formData: FormData) => void | Promise<void>) }
  | { onSignOut: () => void };

export type UserMenuUser = {
  name: string;
  email: string;
  avatarUrl?: string | null;
  /** Shown under the email, e.g. "Owner PM · Dela Cruz Builders". */
  subtitle?: string;
};

export type UserMenuProps = {
  user: UserMenuUser;
  signOut: SignOutHandler;
  profileHref?: string;
  settingsHref?: string;
  /** Extra items rendered before the theme submenu. */
  children?: React.ReactNode;
  /** Hide the Theme submenu (e.g. when a ThemeToggle is already visible next to it). */
  showTheme?: boolean;
  className?: string;
};

/** Big avatar circle (mockups 6–7) with Profile, Settings, Theme and a red Sign out. */
export function UserMenu({
  user,
  signOut,
  profileHref = "/profile",
  settingsHref = "/settings",
  children,
  showTheme = true,
  className,
}: UserMenuProps) {
  const formRef = useRef<HTMLFormElement>(null);
  const [theme, setTheme] = useThemeChoice();

  return (
    <>
      {"action" in signOut ? (
        // Lives outside the menu so it is still mounted when the menu closes on select.
        <form
          ref={formRef}
          action={signOut.action}
          method={typeof signOut.action === "string" ? "post" : undefined}
          className="hidden"
          aria-hidden
        />
      ) : null}
      <DropdownMenu>
        <DropdownMenuTrigger
          className={cn(
            "group relative inline-flex shrink-0 items-center rounded-full focus-ring transition-transform active:scale-95",
            className,
          )}
          aria-label={`Account menu for ${user.name}`}
        >
          <Avatar
            name={user.name}
            src={user.avatarUrl}
            size="lg"
            className="size-11 ring-2 ring-transparent transition-shadow group-hover:ring-border-strong group-data-[state=open]:ring-primary sm:size-12"
          />
        </DropdownMenuTrigger>
        <DropdownMenuContent className="w-72" sideOffset={8}>
          <div className="flex items-center gap-3 px-2.5 pt-2.5 pb-3">
            <Avatar name={user.name} src={user.avatarUrl} size="md" />
            <div className="flex min-w-0 flex-col">
              <span className="truncate text-sm leading-5 font-semibold text-foreground">{user.name}</span>
              <span className="truncate text-xs leading-4 text-muted-foreground">{user.email}</span>
              {user.subtitle ? (
                <span className="mt-1 truncate text-xs leading-4 font-medium text-primary-text">{user.subtitle}</span>
              ) : null}
            </div>
          </div>
          <DropdownMenuSeparator />
          <DropdownMenuGroup>
            <DropdownMenuItem asChild>
              <Link href={profileHref}>
                <UserRound aria-hidden />
                Profile
              </Link>
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <Link href={settingsHref}>
                <Settings aria-hidden />
                Settings
              </Link>
            </DropdownMenuItem>
            {children}
            {showTheme ? (
              <DropdownMenuSub>
                <DropdownMenuSubTrigger>
                  <SunMoon aria-hidden />
                  Theme
                  <span className="ml-auto text-xs text-muted-foreground capitalize">{theme}</span>
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent>
                  <DropdownMenuRadioGroup value={theme} onValueChange={(v) => setTheme(v as ThemeChoice)}>
                    {THEME_OPTIONS.map((option) => (
                      <DropdownMenuRadioItem key={option.value} value={option.value}>
                        {option.value === "system" ? <Monitor aria-hidden /> : option.icon}
                        {option.label}
                      </DropdownMenuRadioItem>
                    ))}
                  </DropdownMenuRadioGroup>
                </DropdownMenuSubContent>
              </DropdownMenuSub>
            ) : null}
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            variant="danger"
            onSelect={() => {
              if ("onSignOut" in signOut) signOut.onSignOut();
              else formRef.current?.requestSubmit();
            }}
          >
            <LogOut aria-hidden />
            Sign out
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  );
}
