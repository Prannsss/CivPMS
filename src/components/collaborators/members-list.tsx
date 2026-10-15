"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Crown, HardHat, UserMinus, UserRound, Users } from "lucide-react";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { SimpleTooltip } from "@/components/ui/tooltip";
import { toast } from "@/components/ui/toaster";
import { companyRoleLabel } from "@/lib/domain/permissions";
import { formatDate } from "@/lib/domain/format";
import { todayInManila } from "@/lib/domain/dates";
import { removeCollaborator } from "@/server/actions/collaborators";
import type { Collaborator } from "@/server/queries/collaborators";

function RoleBadge({ member }: { member: Collaborator }) {
  if (member.isOwner) {
    return (
      <Badge tone="primary" icon={<Crown />}>
        Owner PM
      </Badge>
    );
  }
  if (member.projectRole === "pm") {
    return (
      <Badge tone="info" icon={<UserRound />}>
        Project Manager
      </Badge>
    );
  }
  return (
    <Badge tone="neutral" icon={<HardHat />}>
      Inspector
    </Badge>
  );
}

/** Why Remove is unavailable for this row, or null when it can be removed. */
function removeBlockedReason(member: Collaborator, viewerId: string, pmCount: number): string | null {
  if (member.isOwner) return "The Owner PM has access to every project and can't be removed.";
  if (member.userId === viewerId && member.projectRole === "pm" && pmCount <= 1) {
    return "You're the only Project Manager here. Invite another PM before leaving.";
  }
  return null;
}

/**
 * Project members (spec §4.4): avatar, name, email, project role, company role, joined. Managers
 * can remove people from this project only; the confirmation states the impact.
 */
export function MembersList({
  projectId,
  projectName,
  members,
  viewerId,
  canManage,
}: {
  projectId: string;
  projectName: string;
  members: Collaborator[];
  viewerId: string;
  canManage: boolean;
}) {
  const router = useRouter();
  const confirm = useConfirm();
  const [removing, setRemoving] = useState<string | null>(null);
  const pmCount = members.filter((m) => !m.isOwner && m.projectRole === "pm").length;

  async function onRemove(member: Collaborator) {
    const self = member.userId === viewerId;
    const ok = await confirm({
      title: self ? `Leave "${projectName}"?` : `Remove ${member.name} from this project?`,
      description: self
        ? "You lose access to this project right away. Your past changes stay in the audit trail."
        : `${member.name} loses access to this project only and stays in your company. Their past updates stay in the audit trail, under their name.`,
      tone: "danger",
      confirmLabel: self ? "Leave project" : "Remove from project",
    });
    if (!ok) return;
    setRemoving(member.userId);
    const result = await removeCollaborator({ projectId, userId: member.userId });
    setRemoving(null);
    if (!result.ok) {
      toast.error(self ? "Couldn't leave the project" : `Couldn't remove ${member.name}`, { description: result.error.message });
      return;
    }
    if (result.data.removedSelf) {
      toast.success(`You left ${projectName}`);
      router.push("/");
      return;
    }
    toast.success(`${member.name} was removed from the project`);
    router.refresh();
  }

  if (members.length === 0) {
    return (
      <EmptyState
        variant="plain"
        size="sm"
        icon={<Users />}
        title="Nobody here yet"
        description="Invite Project Managers and inspectors to plan and track this project together."
        headingLevel="h3"
      />
    );
  }

  return (
    <div role="table" aria-label="Project members" className="flex flex-col">
      <div
        role="row"
        className="hidden border-b border-border px-5 pb-2.5 text-xs font-medium text-muted-foreground md:grid md:grid-cols-[minmax(0,2.2fr)_minmax(0,1.1fr)_minmax(0,1fr)_minmax(0,0.9fr)_8.5rem] md:gap-4 sm:px-6"
      >
        <span role="columnheader">Name</span>
        <span role="columnheader">Project role</span>
        <span role="columnheader">Company role</span>
        <span role="columnheader">Joined</span>
        <span role="columnheader" className="sr-only">
          Actions
        </span>
      </div>
      <div role="rowgroup" className="flex flex-col divide-y divide-border">
        {members.map((member) => {
          const self = member.userId === viewerId;
          const blocked = removeBlockedReason(member, viewerId, pmCount);
          const removeButton = (
            <Button
              variant="ghost"
              size="sm"
              className="text-danger-text hover:bg-danger-soft hover:text-danger-text max-sm:h-11"
              onClick={() => onRemove(member)}
              disabled={Boolean(blocked) || removing !== null}
              loading={removing === member.userId}
              aria-label={self ? "Leave project" : `Remove ${member.name}`}
            >
              <UserMinus aria-hidden />
              {self ? "Leave" : "Remove"}
            </Button>
          );
          return (
            <div
              role="row"
              key={member.userId}
              className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-2 px-5 py-3.5 sm:px-6 md:grid-cols-[minmax(0,2.2fr)_minmax(0,1.1fr)_minmax(0,1fr)_minmax(0,0.9fr)_8.5rem]"
            >
              <div role="cell" className="flex min-w-0 items-center gap-3">
                <span aria-hidden>
                  <Avatar name={member.name} src={member.avatarUrl} size="md" />
                </span>
                <div className="flex min-w-0 flex-col">
                  <span className="flex min-w-0 items-center gap-2 text-sm font-medium text-foreground">
                    <span className="truncate">{member.name}</span>
                    {self ? (
                      <Badge size="sm" tone="neutral" variant="outline">
                        You
                      </Badge>
                    ) : null}
                  </span>
                  <span className="truncate text-[13px] text-muted-foreground">{member.email ?? "—"}</span>
                </div>
              </div>
              <div role="cell" className="col-start-1 row-start-2 flex flex-wrap items-center gap-2 md:col-start-auto md:row-start-auto">
                <RoleBadge member={member} />
                <span className="text-xs text-muted-foreground md:hidden">
                  {member.companyRole ? companyRoleLabel(member.companyRole) : "—"} · joined {formatDate(todayInManila(new Date(member.joinedAt)))}
                </span>
              </div>
              <div role="cell" className="hidden text-sm text-muted-foreground md:block">
                {member.companyRole ? companyRoleLabel(member.companyRole) : "—"}
              </div>
              <div role="cell" className="hidden text-sm text-muted-foreground tabular-nums md:block">
                {member.isOwner && !member.projectRole ? "All projects" : formatDate(todayInManila(new Date(member.joinedAt)))}
              </div>
              <div role="cell" className="col-start-2 row-span-2 row-start-1 flex justify-end md:col-start-auto md:row-span-1 md:row-start-auto">
                {canManage && !member.isOwner ? (
                  blocked ? (
                    <SimpleTooltip content={blocked}>
                      <span tabIndex={0} className="rounded-md focus-ring">
                        {removeButton}
                      </span>
                    </SimpleTooltip>
                  ) : (
                    removeButton
                  )
                ) : member.isOwner ? (
                  <span className="hidden text-xs text-muted-foreground md:inline">Always has access</span>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

