"use client";

import { Bell, KeyRound, LogOut, Palette, UserRound } from "lucide-react";
import type { ProfilePageData } from "@/server/queries/profile";
import { AccountSection } from "./account-section";
import { DisplaySection } from "./display-section";
import { NotificationsSection } from "./notifications-section";
import { PasswordSection } from "./password-section";
import { SessionSection } from "./session-section";
import { SettingsLayout, type SettingsNavItem } from "./settings-layout";

const NAV: SettingsNavItem[] = [
  { id: "account", label: "Account", icon: UserRound },
  { id: "display", label: "Display", icon: Palette },
  { id: "notifications", label: "Notifications", icon: Bell },
  { id: "password", label: "Password", icon: KeyRound },
  { id: "session", label: "Sign out", icon: LogOut },
];

/** Profile page body: section nav + Account, Display, Notifications, Password and Sign out. */
export function ProfileView({ data }: { data: ProfilePageData }) {
  return (
    <SettingsLayout nav={NAV} label="Profile sections">
      <AccountSection
        userId={data.userId}
        fullName={data.fullName}
        email={data.email}
        avatarUrl={data.avatarUrl}
        hasGoogle={data.hasGoogle}
        company={data.company}
        rolePref={data.rolePref}
      />
      <DisplaySection initialUnit={data.durationUnit} />
      <NotificationsSection initial={data.prefs} />
      <PasswordSection email={data.email} hasPassword={data.hasPassword} />
      <SessionSection email={data.email} />
    </SettingsLayout>
  );
}
