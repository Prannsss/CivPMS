"use client";

import { useState, useSyncExternalStore } from "react";
import { Tabs as TabsPrimitive } from "radix-ui";
import { ChevronRight, Flag, PencilRuler, TriangleAlert, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { isProjectSettingsSection, type ProjectSettingsSectionId } from "./section-ids";

type SectionMeta = {
  id: ProjectSettingsSectionId;
  title: string;
  description: string;
  icon: LucideIcon;
  tone?: "danger";
};

const SECTIONS: SectionMeta[] = [
  { id: "details", title: "Details", description: "Dates and budget drive the Delayed and budget badges.", icon: PencilRuler },
  {
    id: "status",
    title: "Status",
    description: "Planning → Active → On-Hold → Completed, or Cancelled. Everyone on the project is notified.",
    icon: Flag,
  },
  { id: "danger", title: "Danger zone", description: "Only the Owner PM can delete a project.", icon: TriangleAlert, tone: "danger" },
];

function subscribeHash(onChange: () => void) {
  window.addEventListener("hashchange", onChange);
  return () => window.removeEventListener("hashchange", onChange);
}

/**
 * Project Settings layout: clickable section rows on the left (stacked on top on phones) switch
 * the panel beside them. The choice lives in `?section=` (old `#status` links still work). All
 * panels stay mounted, so switching rows never throws away an edit in progress.
 */
export function ProjectSettingsView({
  initialSection,
  showDanger,
  panels,
}: {
  initialSection: ProjectSettingsSectionId | null;
  showDanger: boolean;
  panels: Record<ProjectSettingsSectionId, React.ReactNode>;
}) {
  const sections = SECTIONS.filter((section) => section.id !== "danger" || showDanger);
  const allowed = (value: string | null | undefined): ProjectSettingsSectionId | null =>
    isProjectSettingsSection(value) && sections.some((section) => section.id === value) ? value : null;

  const hash = useSyncExternalStore(subscribeHash, () => window.location.hash.slice(1), () => "");
  const [picked, setPicked] = useState<ProjectSettingsSectionId | null>(null);
  const active = picked ?? allowed(hash) ?? allowed(initialSection) ?? "details";

  function select(value: string) {
    const next = allowed(value);
    if (!next) return;
    setPicked(next);
    const url = new URL(window.location.href);
    url.searchParams.set("section", next);
    url.hash = "";
    window.history.replaceState(window.history.state, "", url.toString());
  }

  return (
    <TabsPrimitive.Root
      value={active}
      onValueChange={select}
      orientation="vertical"
      className="grid items-start gap-5 lg:grid-cols-[17.5rem_minmax(0,1fr)] lg:gap-8"
    >
      <TabsPrimitive.List aria-label="Settings sections" className="flex flex-col gap-1.5 lg:sticky lg:top-24">
        {sections.map((section) => {
          const Icon = section.icon;
          const danger = section.tone === "danger";
          return (
            <TabsPrimitive.Trigger
              key={section.id}
              value={section.id}
              data-testid={`settings-tab-${section.id}`}
              className={cn(
                "group flex w-full items-start gap-3 rounded-lg border px-4 py-3.5 text-left transition-[background-color,border-color,box-shadow] duration-200 ease-in-out focus-ring",
                "border-transparent hover:bg-surface-sunken",
                danger
                  ? "data-[state=active]:border-danger/30 data-[state=active]:bg-danger-soft"
                  : "data-[state=active]:border-primary/25 data-[state=active]:bg-primary-soft",
                "data-[state=active]:shadow-xs",
              )}
            >
              <Icon
                aria-hidden
                className={cn(
                  "mt-0.5 size-5 shrink-0 transition-colors",
                  danger
                    ? "text-danger-text"
                    : "text-muted-foreground group-data-[state=active]:text-primary-text",
                )}
              />
              <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span
                  className={cn(
                    "text-sm leading-6 font-semibold",
                    danger ? "text-danger-text" : "text-foreground group-data-[state=active]:text-primary-text",
                  )}
                >
                  {section.title}
                </span>
                <span className="text-[13px] leading-5 text-pretty text-muted-foreground">{section.description}</span>
              </span>
              <ChevronRight
                aria-hidden
                className="mt-1 size-4 shrink-0 text-muted-foreground opacity-0 transition-[opacity,translate] duration-200 ease-in-out group-hover:translate-x-0.5 group-hover:opacity-100 group-data-[state=active]:opacity-100"
              />
            </TabsPrimitive.Trigger>
          );
        })}
      </TabsPrimitive.List>

      {sections.map((section) => (
        <TabsPrimitive.Content
          key={section.id}
          value={section.id}
          forceMount
          className="min-w-0 rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 data-[state=active]:animate-page-in data-[state=inactive]:hidden"
        >
          {panels[section.id]}
        </TabsPrimitive.Content>
      ))}
    </TabsPrimitive.Root>
  );
}
