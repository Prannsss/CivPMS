import Link from "next/link";
import { ArrowUpRight, HardHat, MailCheck, UserRound } from "lucide-react";
import { SettingsCard } from "@/components/profile/settings-layout";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { diffDays, todayInManila, type ISODate } from "@/lib/domain/dates";
import { formatDate } from "@/lib/domain/format";
import type { CompanyPendingInvitation } from "@/server/queries/company";

function expiresText(expiresAt: string, today: ISODate): string {
  const days = diffDays(todayInManila(new Date(expiresAt)), today);
  if (days <= 0) return "Expires today";
  if (days === 1) return "Expires tomorrow";
  return `Expires in ${days} days`;
}

/**
 * Read-only overview of pending email invitations across the company's projects (only projects
 * the viewer manages come back from the database). Resend and revoke live in each project's
 * Collaborators tab, linked from every row.
 */
export function PendingInvitations({
  invitations,
  today,
  isOwner,
}: {
  invitations: CompanyPendingInvitation[];
  today: ISODate;
  isOwner: boolean;
}) {
  return (
    <SettingsCard
      id="invitations"
      title="Pending invitations"
      description={`Email invitations waiting for an answer${isOwner ? " across all projects" : " on projects you manage"}. Resend or revoke them from the project's Collaborators tab.`}
      flush
    >
      {invitations.length === 0 ? (
        <div className="px-5 pb-5 sm:px-6">
          <EmptyState
            variant="dashed"
            size="sm"
            icon={<MailCheck />}
            title="No pending invitations"
            description="Invite Project Managers and inspectors by email from a project's Collaborators tab."
            headingLevel="h3"
          />
        </div>
      ) : (
        <ul className="flex flex-col divide-y divide-border border-t border-border">
          {invitations.map((invitation) => (
            <li key={invitation.id} className="flex flex-col gap-x-4 gap-y-1 px-5 py-3.5 sm:flex-row sm:items-center sm:px-6">
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <span className="flex min-w-0 flex-wrap items-center gap-2">
                  <span className="min-w-0 text-sm font-medium break-all text-foreground">{invitation.email}</span>
                  <Badge size="sm" tone={invitation.role === "pm" ? "info" : "neutral"} icon={invitation.role === "pm" ? <UserRound /> : <HardHat />}>
                    {invitation.role === "pm" ? "Project Manager" : "Inspector"}
                  </Badge>
                </span>
                <span className="text-xs leading-4 text-muted-foreground">
                  {invitation.invitedByName ? `Invited by ${invitation.invitedByName} on ` : "Invited on "}
                  <span className="tabular-nums">{formatDate(todayInManila(new Date(invitation.createdAt)))}</span> ·{" "}
                  <span className="tabular-nums">{expiresText(invitation.expiresAt, today)}</span>
                </span>
              </div>
              {invitation.projectId ? (
                <Link
                  href={`/projects/${invitation.projectId}/collaborators`}
                  className="inline-flex min-h-11 max-w-full items-center gap-1.5 self-start rounded-md sm:self-auto text-[13px] font-medium text-primary-text focus-ring hover:underline sm:min-h-9"
                >
                  <span className="truncate">{invitation.projectName ?? "Open project"}</span>
                  <ArrowUpRight aria-hidden className="size-4 shrink-0" />
                </Link>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </SettingsCard>
  );
}
