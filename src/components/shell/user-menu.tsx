"use client";

import { useRef } from "react";
import Link from "next/link";
import { LogOut, Moon, Settings, Sun, UserRound } from "lucide-react";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { useThemeChoice } from "./theme-toggle";

/** Sign-out target: a POST form action (URL such as "/auth/signout" or a server action) or a callback. */
export type SignOutHandler =
  | { action: string | ((formData: FormData) => void | Promise<void>) }
  | { onSignOut: () => void };

export type UserMenuUser = {
  name: string;
  email: string;
  avatarUrl?: string | null;
  /** Role badge in the menu header, e.g. "Owner PM". */
  role?: string;
  /** Company line under the name, e.g. "Dela Cruz Builders" or "No company yet". */
  company?: string;
  /** Older single line ("Owner PM · Dela Cruz Builders"); used when `role`/`company` are absent. */
  subtitle?: string;
};

export type UserMenuProps = {
  user: UserMenuUser;
  signOut: SignOutHandler;
  profileHref?: string;
  /** `null` hides the Settings item (e.g. company settings are Owner-PM-only). */
  settingsHref?: string | null;
  /** Label of the settings item, e.g. "Company settings". */
  settingsLabel?: string;
  /** Extra items rendered before the theme submenu. */
  children?: React.ReactNode;
  /** Hide the Theme submenu (e.g. when a ThemeToggle is already visible next to it). */
  showTheme?: boolean;
  className?: string;
};

/** Big avatar circle (mockups 6–7) with Profile, Settings, Theme and a red Logout. */
export function UserMenu({
  user,
  signOut,
  profileHref = "/profile",
  settingsHref = "/settings",
  settingsLabel = "Settings",
  children,
  showTheme = true,
  className,
}: UserMenuProps) {
  const formRef = useRef<HTMLFormElement>(null);
  const { theme, toggle } = useThemeChoice();

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
          {/* Name first, then who they are at work: role badge + company. No email (it's on Profile). */}
          <div className="flex items-center gap-3 px-2.5 pt-2.5 pb-3">
            <Avatar name={user.name} src={user.avatarUrl} size="lg" />
            <div className="flex min-w-0 flex-col gap-1">
              <span className="truncate text-[15px] leading-5 font-semibold text-foreground">{user.name}</span>
              {user.company ? <span className="truncate text-xs leading-4 text-muted-foreground">{user.company}</span> : null}
              {user.role ? (
                <Badge tone="primary" size="sm" className="mt-0.5 self-start">
                  {user.role}
                </Badge>
              ) : null}
              {!user.role && !user.company && user.subtitle ? (
                <span className="truncate text-xs leading-4 text-muted-foreground">{user.subtitle}</span>
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
            {settingsHref ? (
              <DropdownMenuItem asChild>
                <Link href={settingsHref}>
                  <Settings aria-hidden />
                  {settingsLabel}
                </Link>
              </DropdownMenuItem>
            ) : null}
            {children}
            {showTheme ? (
              <DropdownMenuItem
                // Stays open so the change is visible; the label always says what a click does.
                onSelect={(event) => {
                  event.preventDefault();
                  toggle();
                }}
              >
                {theme === "dark" ? <Sun aria-hidden /> : <Moon aria-hidden />}
                {theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
              </DropdownMenuItem>
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
            Logout
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  );
}
