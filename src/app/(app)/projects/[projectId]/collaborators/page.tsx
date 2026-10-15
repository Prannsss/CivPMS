import type { Metadata } from "next";
import { InviteCodesPanel } from "@/components/collaborators/invite-codes-panel";
import { InviteDialog } from "@/components/collaborators/invite-dialog";
import { InvitationsList } from "@/components/collaborators/invitations-list";
import { MembersList } from "@/components/collaborators/members-list";
import { Card, CardAction, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/ui/page-header";
import { todayInManila } from "@/lib/domain/dates";
import { pluralize } from "@/lib/domain/format";
import { getProjectAccess, requireUser } from "@/server/context";
import { getCollaborators, getProjectInvitations, getProjectInviteCodes } from "@/server/queries/collaborators";

export const metadata: Metadata = { title: "Collaborators" };

/** Collaborators (spec §4.4, D11): members, email invitations and project invite codes. */
export default async function CollaboratorsPage({ params }: PageProps<"/projects/[projectId]/collaborators">) {
  const { projectId } = await params;
  const [{ project, permissions }, { user }] = await Promise.all([getProjectAccess(projectId), requireUser()]);
  const canManage = permissions.canManageMembers;
  const [members, invitations, codes] = await Promise.all([
    getCollaborators(project.id, project.company_id),
    canManage ? getProjectInvitations(project.id) : Promise.resolve([]),
    canManage ? getProjectInviteCodes(project.id) : Promise.resolve([]),
  ]);
  const today = todayInManila();
  const pending = invitations.filter((invitation) => invitation.state === "pending").length;
  const pms = members.filter((member) => member.isOwner || member.projectRole === "pm").length;
  const inspectors = members.length - pms;
  const activeCodes = codes.filter((code) => code.state === "active").length;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        className="pb-0 sm:pb-0"
        title="Collaborators"
        description={`${pluralize(members.length, "person", "people")} on this project · ${pluralize(pms, "manager")}, ${pluralize(inspectors, "inspector")}${
          canManage && pending > 0 ? ` · ${pending} invitation${pending === 1 ? "" : "s"} pending` : ""
        }`}
        actions={canManage ? <InviteDialog projectId={project.id} projectName={project.name} /> : null}
      />

      <Card>
        <CardHeader className="pb-4 sm:pb-4">
          <CardTitle>Members</CardTitle>
          <CardDescription>
            {canManage
              ? "Removing someone takes away this project only. They stay in your company."
              : "Only Project Managers can invite or remove people."}
          </CardDescription>
        </CardHeader>
        <div className="pb-2">
          <MembersList
            projectId={project.id}
            projectName={project.name}
            members={members}
            viewerId={user.id}
            canManage={canManage}
          />
        </div>
      </Card>

      {canManage ? (
        <div className="grid items-start gap-6 xl:grid-cols-2">
          <Card>
            <CardHeader className="pb-4 sm:pb-4">
              <CardTitle>Pending invitations</CardTitle>
              <CardDescription>Email invitations expire after 7 days. Resend to send a fresh link.</CardDescription>
              {invitations.length > 0 ? (
                <CardAction>
                  <Badge tone={pending > 0 ? "primary" : "neutral"} className="tabular-nums">
                    {invitations.length}
                  </Badge>
                </CardAction>
              ) : null}
            </CardHeader>
            <div className="border-t border-border pb-1">
              <InvitationsList projectId={project.id} invitations={invitations} today={today} />
            </div>
          </Card>

          <Card>
            <CardHeader className="pb-4 sm:pb-4">
              <CardTitle>Invite codes</CardTitle>
              <CardDescription>For inspectors: they enter the code when they join, no email needed.</CardDescription>
              {activeCodes > 0 ? (
                <CardAction>
                  <Badge tone="success" className="tabular-nums">
                    {activeCodes} active
                  </Badge>
                </CardAction>
              ) : null}
            </CardHeader>
            <div className="border-t border-border">
              <InviteCodesPanel projectId={project.id} codes={codes} today={today} />
            </div>
          </Card>
        </div>
      ) : null}
    </div>
  );
}
