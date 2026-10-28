"use client";

import { Building2, CalendarDays, KeyRound, MailCheck, Users } from "lucide-react";
import { SettingsLayout, type SettingsNavItem } from "@/components/profile/settings-layout";

const ALL_NAV: SettingsNavItem[] = [
  { id: "general", label: "General", icon: Building2 },
  { id: "calendar", label: "Working calendar", icon: CalendarDays },
  { id: "members", label: "Members", icon: Users },
  { id: "invite-codes", label: "Invite codes", icon: KeyRound },
  { id: "invitations", label: "Invitations", icon: MailCheck },
];

/** Section nav for company settings; PMs and inspectors see fewer sections. */
export function CompanySettingsView({ sections, children }: { sections: string[]; children: React.ReactNode }) {
  const nav = ALL_NAV.filter((item) => sections.includes(item.id));
  return (
    <SettingsLayout nav={nav} label="Company settings sections">
      {children}
    </SettingsLayout>
  );
}
