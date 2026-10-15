"use client";

import { useState } from "react";
import { BellRing, Mail, MailCheck, Sparkles } from "lucide-react";
import { RadioGroup, ChoiceCard } from "@/components/ui/radio-group";
import { Switch } from "@/components/ui/switch";
import { toast } from "@/components/ui/toaster";
import { updateNotificationPrefs } from "@/server/actions/profile";
import type { EmailDigest, PrefGroup, ResolvedPrefs } from "./notification-prefs";
import { SettingsCard } from "./settings-layout";

type Channel = "inApp" | "email";

/**
 * Per-event in-app and email switches (spec §14) plus the daily email digest. Every change saves
 * immediately and rolls back with a snackbar if the server refuses it.
 */
export function NotificationsSection({ initial }: { initial: ResolvedPrefs }) {
  const [groups, setGroups] = useState<PrefGroup[]>(initial.groups);
  const [digest, setDigest] = useState<EmailDigest>(initial.emailDigest);
  const [pending, setPending] = useState<string | null>(null);

  function patchRow(type: string, channel: Channel, value: boolean) {
    setGroups((current) =>
      current.map((group) => ({
        ...group,
        rows: group.rows.map((row) => (row.type === type ? { ...row, [channel]: value } : row)),
      })),
    );
  }

  async function toggle(type: string, label: string, channel: Channel, value: boolean) {
    const row = groups.flatMap((group) => group.rows).find((r) => r.type === type);
    if (!row) return;
    patchRow(type, channel, value);
    setPending(`${type}:${channel}`);
    const next = { inApp: row.inApp, email: row.email, [channel]: value };
    const result = await updateNotificationPrefs({ types: { [type]: next } });
    setPending(null);
    if (!result.ok) {
      patchRow(type, channel, !value);
      toast.error("Couldn't save your notification settings", { description: result.error.message });
      return;
    }
    toast.success(`${label}: ${channel === "inApp" ? "in-app" : "email"} ${value ? "on" : "off"}`, { id: "notification-prefs" });
  }

  async function changeDigest(value: EmailDigest) {
    const previous = digest;
    setDigest(value);
    setPending("digest");
    const result = await updateNotificationPrefs({ emailDigest: value });
    setPending(null);
    if (!result.ok) {
      setDigest(previous);
      toast.error("Couldn't change how emails arrive", { description: result.error.message });
      return;
    }
    toast.success(value === "daily" ? "Emails will arrive as one daily summary" : "Emails will arrive right away", {
      id: "notification-prefs",
    });
  }

  return (
    <SettingsCard
      id="notifications"
      title="Notifications"
      description="Choose what reaches you in the app and by email. Changes save right away."
      flush
    >
      <div role="table" aria-label="Notification preferences" className="flex flex-col">
        <div
          role="row"
          className="grid grid-cols-[minmax(0,1fr)_3.75rem_3.75rem] items-end gap-3 border-b border-border px-5 pb-2.5 text-xs font-medium text-muted-foreground sm:grid-cols-[minmax(0,1fr)_5.5rem_5.5rem] sm:px-6"
        >
          <span role="columnheader">Event</span>
          <span role="columnheader" className="flex flex-col items-center gap-1 text-center">
            <BellRing aria-hidden className="size-4" />
            In-app
          </span>
          <span role="columnheader" className="flex flex-col items-center gap-1 text-center">
            <Mail aria-hidden className="size-4" />
            Email
          </span>
        </div>
        {groups.map((group) => (
          <div role="rowgroup" key={group.key} className="flex flex-col">
            <div role="row" className="bg-surface-muted px-5 py-2 sm:px-6">
              <span role="rowheader" className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                {group.title}
              </span>
            </div>
            <div className="flex flex-col divide-y divide-border">
              {group.rows.map((row) => (
                <div
                  role="row"
                  key={row.type}
                  data-testid={`pref-${row.type}`}
                  className="grid grid-cols-[minmax(0,1fr)_3.75rem_3.75rem] items-center gap-3 px-5 py-3.5 sm:grid-cols-[minmax(0,1fr)_5.5rem_5.5rem] sm:px-6"
                >
                  <div role="cell" className="flex min-w-0 flex-col gap-0.5">
                    <span className="text-sm leading-5 font-medium text-foreground">{row.label}</span>
                    <span className="text-[13px] leading-5 text-muted-foreground">{row.description}</span>
                  </div>
                  <div role="cell" className="flex justify-center">
                    <Switch
                      aria-label={`${row.label}: in-app`}
                      checked={row.inApp}
                      disabled={pending === `${row.type}:inApp`}
                      onCheckedChange={(value) => void toggle(row.type, row.label, "inApp", value)}
                    />
                  </div>
                  <div role="cell" className="flex justify-center">
                    <Switch
                      aria-label={`${row.label}: email`}
                      checked={row.email}
                      disabled={pending === `${row.type}:email`}
                      onCheckedChange={(value) => void toggle(row.type, row.label, "email", value)}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      <div className="flex flex-col gap-4 border-t border-border px-5 pt-5 pb-5 sm:px-6 sm:pb-6">
        <div className="flex flex-col gap-0.5">
          <h3 id="email-delivery-label" className="text-sm leading-6 font-semibold text-foreground">
            Email delivery
          </h3>
          <p className="text-[13px] leading-5 text-muted-foreground">
            Too many emails? Get one summary each morning instead. In-app notifications still arrive instantly.
          </p>
        </div>
        <RadioGroup
          aria-labelledby="email-delivery-label"
          value={digest}
          onValueChange={(value) => void changeDigest(value as EmailDigest)}
          disabled={pending === "digest"}
          className="grid gap-3 md:grid-cols-2"
        >
          <ChoiceCard value="off" icon={<MailCheck />} title="Right away" description="One email per event, as it happens." />
          <ChoiceCard value="daily" icon={<Sparkles />} title="Daily summary" description="One email each morning with everything since the last one." />
        </RadioGroup>
        {initial.upcoming.length > 0 ? (
          <p className="text-xs leading-5 text-muted-foreground">
            Coming with site inspections and progress updates: {initial.upcoming.join(", ").toLowerCase()}.
          </p>
        ) : null}
      </div>
    </SettingsCard>
  );
}
