"use client";

import { useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { Check, Clock, Mail, TriangleAlert, UserRound } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { toast } from "@/components/ui/toaster";
import { diffDays, todayInManila } from "@/lib/domain/dates";
import { formatDate, pluralize } from "@/lib/domain/format";
import { projectRoleLabel } from "@/lib/domain/permissions";
import { cn } from "@/lib/utils";
import { acceptInvitation, declineInvitation, type AcceptedInvitation } from "@/server/actions/invitations-incoming";
import type { PendingInvitation } from "@/server/queries/invitations";

export type { PendingInvitation } from "@/server/queries/invitations";

export type PendingInvitationsProps = {
  invitations: ReadonlyArray<PendingInvitation>;
  /** The viewer's company; joining a different (first) company asks for confirmation. */
  currentCompanyId?: string | null;
  /**
   * The viewer's company name. Invitations from another company can't be accepted (one company
   * per account, D13): their cards explain that and offer Decline only.
   */
  currentCompanyName?: string | null;
  /** Section heading; pass null to render the cards only. */
  heading?: React.ReactNode | null;
  description?: React.ReactNode;
  headingLevel?: "h2" | "h3";
  /** Open the project after accepting (default true). */
  redirectOnAccept?: boolean;
  onAccepted?: (result: AcceptedInvitation) => void;
  /** Rendered when there is nothing pending (default: nothing). */
  emptyState?: React.ReactNode;
  className?: string;
};

const noopSubscribe = () => () => {};

/** Today's date in Manila, only after hydration (relative expiry text is client-only). */
function useTodayInManila(): string | null {
  return useSyncExternalStore(
    noopSubscribe,
    () => todayInManila(),
    () => null,
  );
}

function expiryText(expiresAt: string, today: string | null): string {
  const expiryDate = todayInManila(new Date(expiresAt));
  const absolute = formatDate(expiryDate);
  if (!today) return `Expires ${absolute}`;
  const days = diffDays(expiryDate, today);
  if (days <= 0) return `Expires today · ${absolute}`;
  if (days === 1) return `Expires tomorrow · ${absolute}`;
  return `Expires in ${pluralize(days, "day")} · ${absolute}`;
}

type Busy = { id: string; action: "accept" | "decline" } | null;

/**
 * Email invitations waiting for the signed-in user (spec §4.3–4.4): company, project, role,
 * inviter and expiry, with Accept / Decline. Accepting opens the project; declining tells the
 * inviter. Used by onboarding and the home screen.
 */
export function PendingInvitations({
  invitations,
  currentCompanyId = null,
  currentCompanyName = null,
  heading = "Invitations for you",
  description,
  headingLevel = "h2",
  redirectOnAccept = true,
  onAccepted,
  emptyState = null,
  className,
}: PendingInvitationsProps) {
  const router = useRouter();
  const confirm = useConfirm();
  const today = useTodayInManila();
  const [busy, setBusy] = useState<Busy>(null);
  const [done, setDone] = useState<ReadonlySet<string>>(() => new Set());

  const visible = invitations.filter((invitation) => !done.has(invitation.id));
  if (visible.length === 0) return <>{emptyState}</>;

  const Heading = headingLevel;

  async function accept(invitation: PendingInvitation) {
    if (currentCompanyId !== invitation.companyId) {
      const ok = await confirm({
        title: `Join ${invitation.companyName}?`,
        description: currentCompanyId
          ? `You'll get access to ${invitation.projectName} as ${projectRoleLabel(invitation.role)}.`
          : `You'll get access to ${invitation.projectName} as ${projectRoleLabel(invitation.role)}. An account belongs to one company, so you'll work in CivPMS as part of ${invitation.companyName}.`,
        confirmLabel: `Join ${invitation.companyName}`,
        cancelLabel: "Not now",
        icon: <Mail />,
      });
      if (!ok) return;
    }
    setBusy({ id: invitation.id, action: "accept" });
    const result = await acceptInvitation({ invitationId: invitation.id });
    if (!result.ok) {
      setBusy(null);
      toast.error("Couldn't accept the invitation", { description: result.error.message });
      router.refresh();
      return;
    }
    setDone((previous) => new Set(previous).add(invitation.id));
    setBusy(null);
    toast.success(`You joined ${result.data.projectName}`, {
      description: `${result.data.companyName} · ${projectRoleLabel(result.data.role)}`,
    });
    onAccepted?.(result.data);
    if (redirectOnAccept) router.push(result.data.redirectTo);
    router.refresh();
  }

  async function decline(invitation: PendingInvitation) {
    const ok = await confirm({
      title: `Decline the invitation to ${invitation.projectName}?`,
      description: `${invitation.inviterName} will be told you declined. To join later, you'll need a new invitation.`,
      tone: "danger",
      confirmLabel: "Decline invitation",
      cancelLabel: "Keep it",
    });
    if (!ok) return;
    setBusy({ id: invitation.id, action: "decline" });
    const result = await declineInvitation({ invitationId: invitation.id });
    setBusy(null);
    if (!result.ok) {
      toast.error("Couldn't decline the invitation", { description: result.error.message });
      router.refresh();
      return;
    }
    setDone((previous) => new Set(previous).add(invitation.id));
    toast.message("Invitation declined", { description: `${invitation.projectName} · ${invitation.companyName}` });
    router.refresh();
  }

  return (
    <section
      aria-label={typeof heading === "string" ? heading : "Pending invitations"}
      className={cn("flex flex-col gap-4", className)}
    >
      {heading ? (
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2">
            <Heading className="text-lg leading-[1.625rem] font-semibold tracking-[-0.01em] text-foreground">
              {heading}
            </Heading>
            <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1.5 text-[11px] font-semibold text-primary-foreground tabular-nums">
              {visible.length}
            </span>
          </div>
          {description ? <p className="text-sm leading-[1.375rem] text-muted-foreground">{description}</p> : null}
        </div>
      ) : null}
      <ul className="flex flex-col gap-3">
        {visible.map((invitation) => {
          const isBusy = busy?.id === invitation.id;
          const blocked = currentCompanyId !== null && invitation.companyId !== currentCompanyId;
          return (
            <li
              key={invitation.id}
              data-testid="pending-invitation"
              className="flex flex-col gap-4 rounded-lg border border-border bg-surface p-4 shadow-xs sm:flex-row sm:items-center sm:gap-5 sm:p-5"
            >
              <div className="flex min-w-0 flex-1 items-start gap-4">
                <span
                  aria-hidden
                  className="grid size-11 shrink-0 place-items-center rounded-xl bg-primary-soft text-primary-text ring-4 ring-primary-soft/40"
                >
                  <Mail className="size-5" />
                </span>
                <div className="flex min-w-0 flex-col gap-1">
                  <p className="truncate text-xs leading-4 font-medium text-muted-foreground">
                    {invitation.companyName}
                  </p>
                  <p className="text-[15px] leading-6 font-semibold tracking-[-0.01em] break-words text-foreground">
                    {invitation.projectName}
                  </p>
                  <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs leading-4 text-muted-foreground">
                    <Badge tone={invitation.role === "pm" ? "primary" : "info"} size="sm">
                      {projectRoleLabel(invitation.role)}
                    </Badge>
                    <span className="inline-flex items-center gap-1">
                      <UserRound aria-hidden className="size-3.5" />
                      Invited by {invitation.inviterName}
                    </span>
                    <span className="inline-flex items-center gap-1 tabular-nums">
                      <Clock aria-hidden className="size-3.5" />
                      {expiryText(invitation.expiresAt, today)}
                    </span>
                  </div>
                  {blocked ? (
                    <p className="mt-2 flex items-start gap-1.5 text-[13px] leading-5 text-warning-text">
                      <TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
                      <span>
                        You&apos;re already part of {currentCompanyName ?? "another company"}. An account belongs to one
                        company, so you can only decline this invitation.
                      </span>
                    </p>
                  ) : null}
                </div>
              </div>
              <div className="flex shrink-0 gap-2 max-sm:[&>*]:flex-1">
                <Button
                  variant="outline"
                  onClick={() => decline(invitation)}
                  disabled={busy !== null && !isBusy}
                  loading={isBusy && busy?.action === "decline"}
                  aria-label={`Decline invitation to ${invitation.projectName}`}
                >
                  Decline
                </Button>
                {blocked ? null : (
                  <Button
                    onClick={() => accept(invitation)}
                    disabled={busy !== null && !isBusy}
                    loading={isBusy && busy?.action === "accept"}
                    loadingText="Joining…"
                    aria-label={`Accept invitation to ${invitation.projectName}`}
                  >
                    <Check aria-hidden />
                    Accept
                  </Button>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
