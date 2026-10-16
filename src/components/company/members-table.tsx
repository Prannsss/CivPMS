"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Crown, HardHat, MoreHorizontal, UserMinus, UserRound, Users } from "lucide-react";
import { SettingsCard } from "@/components/profile/settings-layout";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useConfirm } from "@/components/ui/confirm-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { EmptyState } from "@/components/ui/empty-state";
import { toast } from "@/components/ui/toaster";
import type { CompanyRole } from "@/lib/domain";
import { todayInManila } from "@/lib/domain/dates";
import { formatDate, pluralize } from "@/lib/domain/format";
import { companyRoleLabel } from "@/lib/domain/permissions";
import { removeMember, setMemberRole } from "@/server/actions/company";
import type { CompanyMember } from "@/server/queries/company";

const ROLE_BADGE: Record<CompanyRole, { tone: "primary" | "info" | "neutral"; icon: React.ReactNode }> = {
  owner_pm: { tone: "primary", icon: <Crown /> },
  pm: { tone: "info", icon: <UserRound /> },
  inspector: { tone: "neutral", icon: <HardHat /> },
};

function RoleBadge({ role }: { role: CompanyRole }) {
  return (
    <Badge tone={ROLE_BADGE[role].tone} icon={ROLE_BADGE[role].icon}>
      {companyRoleLabel(role)}
    </Badge>
  );
}

function projectsText(member: CompanyMember): string {
  if (member.role === "owner_pm") return "All projects";
  if (member.projectCount === null) return "—";
  return pluralize(member.projectCount, "project");
}

const GRID_WITH_PROJECTS = "md:grid-cols-[minmax(0,2.4fr)_minmax(0,1.3fr)_minmax(0,0.9fr)_minmax(0,0.9fr)_3rem]";
const GRID_NO_PROJECTS = "md:grid-cols-[minmax(0,2.4fr)_minmax(0,1.3fr)_minmax(0,0.9fr)_3rem]";

/**
 * Company members (spec §2.2, §4.4): avatar, name, email, role, projects and joined date. The
 * Owner PM can switch PM ↔ Inspector and remove people from the company (all project access goes;
 * their history stays attributed to them).
 */
export function MembersTable({
  members,
  viewerId,
  canManage,
  showProjects,
  companyName,
}: {
  members: CompanyMember[];
  viewerId: string;
  canManage: boolean;
  showProjects: boolean;
  companyName: string;
}) {
  const router = useRouter();
  const confirm = useConfirm();
  const GRID = showProjects ? GRID_WITH_PROJECTS : GRID_NO_PROJECTS;
  const [busy, setBusy] = useState<string | null>(null);
  const counts = members.reduce<Record<CompanyRole, number>>(
    (acc, m) => ({ ...acc, [m.role]: acc[m.role] + 1 }),
    { owner_pm: 0, pm: 0, inspector: 0 },
  );

  async function changeRole(member: CompanyMember, role: "pm" | "inspector") {
    if (member.role === role) return;
    if (role === "inspector") {
      const ok = await confirm({
        title: `Make ${member.name} an inspector?`,
        description:
          "They stop being a Project Manager: on every project where they are a PM they become an inspector, and they can no longer create projects or invite people. You can promote them again later.",
        confirmLabel: "Make inspector",
      });
      if (!ok) return;
    }
    setBusy(member.userId);
    const result = await setMemberRole({ userId: member.userId, role });
    setBusy(null);
    if (!result.ok) {
      toast.error(`Couldn't change ${member.name}'s role`, { description: result.error.message });
      return;
    }
    toast.success(
      role === "pm" ? `${member.name} is now a Project Manager` : `${member.name} is now an inspector`,
      role === "pm" ? { description: "They can create projects and be added to projects as PM." } : undefined,
    );
    router.refresh();
  }

  async function remove(member: CompanyMember) {
    const ok = await confirm({
      title: `Remove ${member.name} from ${companyName}?`,
      description: `They lose access to every project in ${companyName} right away and return to “No company yet”. Their past updates stay in the audit trail, under their name. To bring them back, invite them again.`,
      tone: "danger",
      confirmLabel: "Remove from company",
    });
    if (!ok) return;
    setBusy(member.userId);
    const result = await removeMember({ userId: member.userId });
    setBusy(null);
    if (!result.ok) {
      toast.error(`Couldn't remove ${member.name}`, { description: result.error.message });
      return;
    }
    toast.success(`${member.name} was removed from ${companyName}`, { description: "They were notified." });
    router.refresh();
  }

  const summary = [
    pluralize(members.length, "member"),
    counts.pm > 0 ? pluralize(counts.pm, "Project Manager") : null,
    counts.inspector > 0 ? pluralize(counts.inspector, "inspector") : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <SettingsCard
      id="members"
      title="Members"
      description={
        canManage
          ? `${summary}. Change roles or remove people from the company. To add people, invite them from a project's Collaborators tab or share an invite code.`
          : `${summary}. Only the Owner PM can change roles or remove people.`
      }
      flush
    >
      {members.length === 0 ? (
        <EmptyState
          variant="plain"
          size="sm"
          icon={<Users />}
          title="Nobody here yet"
          description="Invite people from a project's Collaborators tab, or share a company invite code with inspectors."
          headingLevel="h3"
        />
      ) : (
        <div role="table" aria-label="Company members" className="flex flex-col">
          <div
            role="row"
            className={`hidden border-b border-border px-5 pb-2.5 text-xs font-medium text-muted-foreground sm:px-6 md:grid md:gap-4 ${GRID}`}
          >
            <span role="columnheader">Name</span>
            <span role="columnheader">Company role</span>
            {showProjects ? <span role="columnheader">Projects</span> : null}
            <span role="columnheader">Joined</span>
            <span role="columnheader" className="sr-only">
              Actions
            </span>
          </div>
          <div role="rowgroup" className="flex flex-col divide-y divide-border">
            {members.map((member) => {
              const self = member.userId === viewerId;
              const manageable = canManage && member.role !== "owner_pm" && !self;
              const joined = formatDate(todayInManila(new Date(member.joinedAt)));
              return (
                <div
                  role="row"
                  key={member.userId}
                  data-testid={`member-${member.email ?? member.userId}`}
                  className={`grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-2 px-5 py-3.5 sm:px-6 ${GRID}`}
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
                    <RoleBadge role={member.role} />
                    <span className="text-xs text-muted-foreground tabular-nums md:hidden">
                      {showProjects ? `${projectsText(member)} · ` : ""}joined {joined}
                    </span>
                  </div>
                  {showProjects ? (
                    <div role="cell" className="hidden text-sm text-muted-foreground tabular-nums md:block">
                      {projectsText(member)}
                    </div>
                  ) : null}
                  <div role="cell" className="hidden text-sm text-muted-foreground tabular-nums md:block">
                    {joined}
                  </div>
                  <div role="cell" className="col-start-2 row-span-2 row-start-1 flex justify-end md:col-start-auto md:row-span-1 md:row-start-auto">
                    {manageable ? (
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            className="max-sm:size-11"
                            aria-label={`Manage ${member.name}`}
                            loading={busy === member.userId}
                            disabled={busy !== null}
                          >
                            <MoreHorizontal aria-hidden />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-60">
                          <DropdownMenuLabel>Company role</DropdownMenuLabel>
                          <DropdownMenuRadioGroup
                            value={member.role}
                            onValueChange={(value) => void changeRole(member, value as "pm" | "inspector")}
                          >
                            <DropdownMenuRadioItem value="pm">Project Manager</DropdownMenuRadioItem>
                            <DropdownMenuRadioItem value="inspector">Inspector / QA / QC</DropdownMenuRadioItem>
                          </DropdownMenuRadioGroup>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem variant="danger" onSelect={() => void remove(member)}>
                            <UserMinus aria-hidden />
                            Remove from company
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </SettingsCard>
  );
}
