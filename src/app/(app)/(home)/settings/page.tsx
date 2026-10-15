import type { Metadata } from "next";
import Link from "next/link";
import { Building2, Crown, HardHat, UserRound } from "lucide-react";
import { StatusPanel } from "@/components/app-shell/status-page";
import { CalendarDefaults } from "@/components/company/calendar-defaults";
import { CompanyGeneral } from "@/components/company/company-general";
import { CompanyInviteCodes } from "@/components/company/company-invite-codes";
import { CompanySettingsView } from "@/components/company/company-settings-view";
import { MembersTable } from "@/components/company/members-table";
import { PendingInvitations } from "@/components/company/pending-invitations";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { todayInManila } from "@/lib/domain/dates";
import { companyRoleLabel } from "@/lib/domain/permissions";
import { requireOnboarded } from "@/server/context";
import {
  getCompanyInfo,
  getCompanyInviteCodes,
  getCompanyMembers,
  getCompanyPendingInvitations,
} from "@/server/queries/company";

export const metadata: Metadata = { title: "Company settings" };

const ROLE_ICON = { owner_pm: <Crown />, pm: <UserRound />, inspector: <HardHat /> } as const;

function NoCompany() {
  return (
    <div className="flex min-h-[60dvh] items-center justify-center py-12">
      <StatusPanel
        eyebrow="No company yet"
        icon={<Building2 />}
        title="You're not in a company yet"
        description="Company settings appear once you join one. Enter an invite code or accept an invitation from the projects home."
        actions={
          <Button asChild>
            <Link href="/">Join a company</Link>
          </Button>
        }
      />
    </div>
  );
}

/**
 * Company settings (spec §2.2, §4.4, D11, D13). The Owner PM manages everything; company PMs see
 * the company read-only plus company invite codes and the invitations they sent; inspectors see
 * the company and its members read-only. The database enforces the same rules.
 */
export default async function CompanySettingsPage() {
  const context = await requireOnboarded();
  const membership = context.membership;
  if (!membership) return <NoCompany />;

  const isOwner = membership.role === "owner_pm";
  const isPm = membership.role === "pm";
  const canInvite = isOwner || isPm;

  const [company, members, codes, invitations] = await Promise.all([
    getCompanyInfo(membership.companyId),
    getCompanyMembers(membership.companyId, isOwner),
    canInvite ? getCompanyInviteCodes(membership.companyId) : Promise.resolve([]),
    canInvite ? getCompanyPendingInvitations(membership.companyId) : Promise.resolve([]),
  ]);
  if (!company) return <NoCompany />;

  const today = todayInManila();
  const sections = ["general", "calendar", "members", ...(canInvite ? ["invite-codes", "invitations"] : [])];

  return (
    <div className="flex flex-col">
      <PageHeader
        title="Company settings"
        description={
          isOwner
            ? `Manage ${company.name}: its name, default working calendar, members and invite codes.`
            : `${company.name}. Only the Owner PM can change company details and members.`
        }
        meta={
          <Badge tone={isOwner ? "primary" : isPm ? "info" : "neutral"} icon={ROLE_ICON[membership.role]}>
            {`You: ${companyRoleLabel(membership.role)}`}
          </Badge>
        }
      />
      <CompanySettingsView sections={sections}>
        <CompanyGeneral
          name={company.name}
          ownerName={company.ownerName}
          createdAt={company.createdAt}
          canEdit={isOwner}
          memberCount={members.length}
        />
        <CalendarDefaults workDays={company.workDays} hoursPerDay={company.hoursPerDay} canEdit={isOwner} />
        <MembersTable
          members={members}
          viewerId={context.user.id}
          canManage={isOwner}
          showProjects={isOwner}
          companyName={company.name}
        />
        {canInvite ? <CompanyInviteCodes codes={codes} today={today} /> : null}
        {canInvite ? <PendingInvitations invitations={invitations} today={today} isOwner={isOwner} /> : null}
      </CompanySettingsView>
    </div>
  );
}
