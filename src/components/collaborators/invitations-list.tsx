"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Ban, Clock, Copy, Ellipsis, Mail, MailPlus, Send } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useConfirm } from "@/components/ui/confirm-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { EmptyState } from "@/components/ui/empty-state";
import { IconButton } from "@/components/ui/icon-button";
import { toast } from "@/components/ui/toaster";
import { diffDays, todayInManila, type ISODate } from "@/lib/domain/dates";
import { formatDate, pluralize } from "@/lib/domain/format";
import { projectRoleLabel } from "@/lib/domain/permissions";
import { resendInvitation, revokeInvitation, type InviteOutcome } from "@/server/actions/collaborators";
import type { ProjectInvitation } from "@/server/queries/collaborators";
import { copyToClipboard } from "./copy";
import { deliveryHeadline } from "./invite-dialog";

function expiryText(invitation: ProjectInvitation, today: ISODate): string {
  const day = todayInManila(new Date(invitation.expiresAt));
  if (invitation.state === "expired") return `Expired ${formatDate(day)}`;
  const days = diffDays(day, today);
  if (days <= 0) return "Expires today";
  if (days === 1) return "Expires tomorrow";
  return `Expires in ${pluralize(days, "day")}`;
}

/**
 * Pending (and expired) email invitations for managers: Resend (new link, 7 more days), Copy a
 * fresh link, and Revoke with a confirmation.
 */
export function InvitationsList({
  projectId,
  invitations,
  today,
}: {
  projectId: string;
  invitations: ProjectInvitation[];
  today: ISODate;
}) {
  const router = useRouter();
  const confirm = useConfirm();
  const [busy, setBusy] = useState<string | null>(null);

  async function resend(invitation: ProjectInvitation, copy: boolean) {
    setBusy(invitation.id);
    const result = await resendInvitation({ projectId, invitationId: invitation.id });
    setBusy(null);
    if (!result.ok) {
      toast.error("Couldn't resend the invitation", { description: result.error.message });
      return;
    }
    router.refresh();
    const outcome: InviteOutcome = result.data;
    if (copy) {
      await copyToClipboard(outcome.inviteLink, "New invite link copied");
      return;
    }
    const headline = deliveryHeadline(outcome);
    const title = outcome.delivery === "emailed" ? `Invitation resent to ${outcome.email}` : headline.title;
    const notify = outcome.delivery === "not_sent" ? toast.info : toast.success;
    notify(title, {
      description: outcome.delivery === "not_sent" ? (outcome.deliveryNote ?? undefined) : "The link now works for 7 more days.",
      action: { label: "Copy link", onClick: () => void copyToClipboard(outcome.inviteLink, "Invite link copied") },
    });
  }

  async function revoke(invitation: ProjectInvitation) {
    const ok = await confirm({
      title: `Revoke the invitation to ${invitation.email}?`,
      description: "The link in their email stops working right away. You can invite them again later.",
      tone: "danger",
      confirmLabel: "Revoke invitation",
    });
    if (!ok) return;
    setBusy(invitation.id);
    const result = await revokeInvitation({ projectId, invitationId: invitation.id });
    setBusy(null);
    if (!result.ok) {
      toast.error("Couldn't revoke the invitation", { description: result.error.message });
      return;
    }
    toast.success(`Invitation to ${invitation.email} revoked`);
    router.refresh();
  }

  if (invitations.length === 0) {
    return (
      <EmptyState
        variant="plain"
        size="sm"
        icon={<MailPlus />}
        title="No pending invitations"
        description="People you invite by email show up here until they accept, so you can resend or revoke."
        headingLevel="h3"
      />
    );
  }

  return (
    <ul className="flex flex-col divide-y divide-border">
      {invitations.map((invitation) => {
        const expired = invitation.state === "expired";
        return (
          <li key={invitation.id} className="flex items-center gap-3 px-5 py-3.5 sm:px-6">
            <span
              aria-hidden
              className="grid size-10 shrink-0 place-items-center rounded-full border border-dashed border-border-strong text-muted-foreground"
            >
              <Mail className="size-4" />
            </span>
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                <span className="truncate text-sm font-medium text-foreground">{invitation.email}</span>
                <Badge size="sm" tone={invitation.role === "pm" ? "info" : "neutral"}>
                  {projectRoleLabel(invitation.role)}
                </Badge>
                {expired ? (
                  <Badge size="sm" tone="warning" icon={<Clock />}>
                    Expired
                  </Badge>
                ) : null}
              </span>
              <span className="text-xs leading-4 text-muted-foreground">
                {invitation.invitedByName ? `Invited by ${invitation.invitedByName}` : "Invited"} on{" "}
                {formatDate(todayInManila(new Date(invitation.createdAt)))} · {expiryText(invitation, today)}
              </span>
            </div>
            <div className="flex shrink-0 items-center gap-1">
              <Button
                variant="outline"
                size="sm"
                className="hidden sm:inline-flex"
                onClick={() => resend(invitation, false)}
                loading={busy === invitation.id}
                disabled={busy !== null}
              >
                <Send aria-hidden />
                Resend
              </Button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <IconButton aria-label={`More actions for ${invitation.email}`} variant="ghost" size="sm" disabled={busy !== null}>
                    <Ellipsis />
                  </IconButton>
                </DropdownMenuTrigger>
                <DropdownMenuContent>
                  <DropdownMenuItem className="sm:hidden" onSelect={() => resend(invitation, false)}>
                    <Send />
                    Resend invitation
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => resend(invitation, true)}>
                    <Copy />
                    Resend &amp; copy link
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem variant="danger" onSelect={() => revoke(invitation)} disabled={expired}>
                    <Ban />
                    Revoke invitation
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
