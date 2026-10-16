import type { Metadata } from "next";
import Link from "next/link";
import { Building2, Lock } from "lucide-react";
import { ScreenPlaceholder } from "@/components/app-shell/screen-placeholder";
import { StatusPanel } from "@/components/app-shell/status-page";
import { Button } from "@/components/ui/button";
import { requireOnboarded } from "@/server/context";

export const metadata: Metadata = { title: "Company settings" };

/** Placeholder: the company-settings team replaces this page. Owner PM only (spec §2.2). */
export default async function CompanySettingsPage() {
  const context = await requireOnboarded();
  const membership = context.membership;

  if (membership?.role !== "owner_pm") {
    return (
      <div className="flex min-h-[60dvh] items-center justify-center py-12">
        <StatusPanel
          eyebrow="Owner PM only"
          icon={<Lock />}
          title="Company settings are for the Owner PM"
          description={
            membership
              ? `Only the Owner PM of ${membership.companyName} can change its name, members, invite codes and working-day defaults.`
              : "Join a company first. Its Owner PM manages the company's settings."
          }
          actions={
            <Button variant="outline" asChild>
              <Link href="/">Back to projects</Link>
            </Button>
          }
        />
      </div>
    );
  }

  return (
    <ScreenPlaceholder
      title="Company settings"
      description={membership.companyName}
      icon={<Building2 />}
      upcoming="Rename the company, manage members and roles, create invite codes for inspectors, and set the default working days for new projects."
    />
  );
}
