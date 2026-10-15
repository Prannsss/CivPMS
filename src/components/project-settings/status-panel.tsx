"use client";

import { useId, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Archive,
  ArchiveRestore,
  ChevronDown,
  CircleCheck,
  CirclePause,
  CirclePlay,
  CircleX,
  Lock,
  RotateCcw,
  type LucideIcon,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Modal } from "@/components/ui/dialog";
import { StatusBadge } from "@/components/ui/status-badge";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toaster";
import { useConfirm } from "@/components/ui/confirm-dialog";
import {
  canArchiveProjectStatus,
  projectStatusLabel,
  projectTransitions,
  type CompanyRole,
  type ProjectRole,
  type ProjectStatus,
  type ProjectTransition,
} from "@/lib/domain";
import { changeProjectStatus, setProjectArchived } from "@/server/actions/project-settings";

type Copy = { label: string; icon: LucideIcon; description: string; variant: "outline" | "danger-outline" };

function transitionCopy(from: ProjectStatus, transition: ProjectTransition): Copy {
  switch (transition.to) {
    case "active":
      if (from === "planning") {
        return {
          label: "Start the project",
          icon: CirclePlay,
          description: "Moves it to Active and captures Baseline v1: a frozen copy of today's plan to compare progress against.",
          variant: "outline",
        };
      }
      if (from === "completed") {
        return {
          label: "Reopen project",
          icon: RotateCcw,
          description: "Back to Active so work can continue. The reopen is logged.",
          variant: "outline",
        };
      }
      return { label: "Resume work", icon: CirclePlay, description: "Back to Active.", variant: "outline" };
    case "on_hold":
      return {
        label: "Put on hold",
        icon: CirclePause,
        description: "Pauses the project. Everyone on it is notified, with your reason.",
        variant: "outline",
      };
    case "completed":
      return {
        label: "Mark as completed",
        icon: CircleCheck,
        description: "Only when every activity is completed. Completed projects can be archived.",
        variant: "outline",
      };
    case "cancelled":
      return {
        label: "Cancel project",
        icon: CircleX,
        description: "Stops the project for good. It stays readable and can be archived. Owner PM only.",
        variant: "danger-outline",
      };
    default:
      return { label: projectStatusLabel(transition.to), icon: CirclePlay, description: "", variant: "outline" };
  }
}

export interface IncompleteActivity {
  id: string;
  wbsCode: string;
  name: string;
}

/**
 * Status panel (spec §5.2): one button per allowed transition from `projectTransitions`, reason
 * dialogs for On-Hold and Cancel, the blocked completion explained with links into the WBS, and
 * archive / unarchive for closed projects (A8, with Undo).
 */
export function StatusPanel({
  projectId,
  projectName,
  status,
  statusReason,
  isArchived,
  companyRole,
  projectRole,
  activityCount,
  incompleteCount,
  incomplete,
  canArchive,
}: {
  projectId: string;
  projectName: string;
  status: ProjectStatus;
  statusReason: string | null;
  isArchived: boolean;
  companyRole: CompanyRole | null;
  projectRole: ProjectRole | null;
  activityCount: number;
  incompleteCount: number;
  incomplete: IncompleteActivity[];
  canArchive: boolean;
}) {
  const router = useRouter();
  const confirm = useConfirm();
  const reasonId = useId();
  const [pending, setPending] = useState<ProjectStatus | "archive" | null>(null);
  const [reasonFor, setReasonFor] = useState<ProjectTransition | null>(null);
  const [reason, setReason] = useState("");
  const [reasonError, setReasonError] = useState<string | null>(null);
  const [blockedDetail, setBlockedDetail] = useState<string | null>(null);

  const transitions = projectTransitions(status, { companyRole, projectRole, activityCount, incompleteCount });
  // Cancelling is shown only to people who may do it; other blocked edges explain themselves.
  const visible = transitions.filter((t) => t.to !== "cancelled" || t.allowed);

  async function run(to: ProjectStatus, why: string | null): Promise<boolean> {
    setPending(to);
    const result = await changeProjectStatus({ projectId, status: to, reason: why });
    setPending(null);
    if (!result.ok) {
      if (result.error.code === "PROJECT_HAS_INCOMPLETE_ACTIVITIES") {
        setBlockedDetail(result.error.message);
        return true;
      }
      if (result.error.fieldErrors?.reason) {
        setReasonError(result.error.fieldErrors.reason);
        return false;
      }
      toast.error("Couldn't change the status", { description: result.error.message });
      return result.error.code !== "VALIDATION";
    }
    const label = projectStatusLabel(result.data.status);
    if (status === "planning" && to === "active") {
      toast.success(`${projectName} is now Active`, { description: "Baseline v1 was captured from the current plan." });
    } else {
      toast.success(`Status changed to ${label}`);
    }
    router.refresh();
    return true;
  }

  async function onTransition(transition: ProjectTransition) {
    setBlockedDetail(null);
    if (transition.requiresReason) {
      setReason("");
      setReasonError(null);
      setReasonFor(transition);
      return;
    }
    if (transition.to === "completed") {
      const ok = await confirm({
        title: `Mark "${projectName}" as completed?`,
        description: "Every activity is completed. The project closes and can then be archived; you can reopen it later.",
        confirmLabel: "Mark as completed",
      });
      if (!ok) return;
    }
    if (transition.capturesBaseline) {
      const ok = await confirm({
        title: `Start "${projectName}"?`,
        description:
          "The project becomes Active and Baseline v1 is captured from the current work breakdown (dates, hours and costs). Later changes are compared against it.",
        confirmLabel: "Start project",
      });
      if (!ok) return;
    }
    await run(transition.to, null);
  }

  async function submitReason(event: React.FormEvent) {
    event.preventDefault();
    if (!reasonFor) return;
    const trimmed = reason.trim();
    if (!trimmed) {
      setReasonError(
        reasonFor.to === "on_hold"
          ? "Add a reason for putting the project on hold, e.g. \"Waiting for permits\"."
          : "Add a reason for cancelling the project.",
      );
      return;
    }
    const done = await run(reasonFor.to, trimmed);
    if (done) setReasonFor(null);
  }

  async function toggleArchive(next: boolean) {
    setPending("archive");
    const result = await setProjectArchived({ projectId, archived: next });
    setPending(null);
    if (!result.ok) {
      toast.error(next ? "Couldn't archive the project" : "Couldn't unarchive the project", { description: result.error.message });
      return;
    }
    router.refresh();
    toast.undo(next ? "Project archived" : "Project unarchived", () => {
      void setProjectArchived({ projectId, archived: !next }).then((undo) => {
        if (undo.ok) router.refresh();
        else toast.error("Couldn't undo", { description: undo.error.message });
      });
    }, {
      description: next ? "It's hidden from the default project list." : "It shows in the project list again.",
    });
  }

  const completion = transitions.find((t) => t.to === "completed");
  const completionBlocked = completion && !completion.allowed && activityCount > 0;
  const cancelling = reasonFor?.to === "cancelled";

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-sm text-muted-foreground">Current status</span>
        <StatusBadge status={status} size="lg" />
        {isArchived ? (
          <Badge tone="neutral" variant="outline" size="lg" icon={<Archive />}>
            Archived
          </Badge>
        ) : null}
      </div>
      {statusReason && (status === "on_hold" || status === "cancelled") ? (
        <p className="rounded-md border-l-2 border-border-strong bg-surface-muted px-3 py-2 text-sm text-foreground">
          <span className="font-medium">Reason:</span> {statusReason}
        </p>
      ) : null}

      {visible.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {status === "cancelled"
            ? "Cancelled projects can't change status. You can archive it to hide it from the project list."
            : "There are no status changes available."}
        </p>
      ) : (
        <ul className="flex flex-col divide-y divide-border rounded-lg border border-border">
          {visible.map((transition) => {
            const copy = transitionCopy(status, transition);
            const Icon = copy.icon;
            return (
              <li key={transition.to} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between sm:gap-6">
                <div className="flex min-w-0 flex-col gap-0.5">
                  <p className="flex items-center gap-2 text-sm font-medium text-foreground">
                    {copy.label}
                    {transition.capturesBaseline ? (
                      <Badge tone="primary" size="sm">
                        Captures Baseline v1
                      </Badge>
                    ) : null}
                  </p>
                  <p className="text-[13px] leading-5 text-muted-foreground">
                    {transition.allowed ? copy.description : transition.blockedReason}
                  </p>
                </div>
                <Button
                  variant={copy.variant}
                  size="sm"
                  className="w-full shrink-0 sm:w-auto"
                  onClick={() => onTransition(transition)}
                  disabled={!transition.allowed || pending !== null}
                  loading={pending === transition.to}
                >
                  {transition.allowed ? <Icon aria-hidden /> : <Lock aria-hidden />}
                  {copy.label}
                </Button>
              </li>
            );
          })}
        </ul>
      )}

      {completionBlocked || blockedDetail ? (
        <details
          open={blockedDetail !== null}
          className="group rounded-md border border-border bg-surface-muted"
          role={blockedDetail ? "alert" : undefined}
        >
          <summary className="flex cursor-pointer list-none items-center justify-between gap-3 rounded-md px-4 py-3 text-sm font-medium text-foreground focus-ring [&::-webkit-details-marker]:hidden">
            <span>
              Complete these activities first
              <span className="ml-2 font-normal text-muted-foreground tabular-nums">({incompleteCount} open)</span>
            </span>
            <ChevronDown aria-hidden className="size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" />
          </summary>
          <div className="flex flex-col gap-3 px-4 pb-4">
            {blockedDetail ? <p className="text-[13px] leading-5 text-muted-foreground">{blockedDetail}</p> : null}
            {incomplete.length > 0 ? (
              <ul className="flex flex-col gap-1">
                {incomplete.map((activity) => (
                  <li key={activity.id}>
                    <Link
                      href={`/projects/${projectId}/wbs?activity=${activity.id}`}
                      className="inline-flex max-w-full items-baseline gap-2 rounded-xs text-sm text-primary-text hover:underline focus-ring"
                    >
                      <span className="font-mono text-xs tabular-nums">{activity.wbsCode}</span>
                      <span className="truncate">{activity.name}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            ) : null}
            {incompleteCount > incomplete.length ? (
              <p className="text-xs text-muted-foreground">
                …and {incompleteCount - incomplete.length} more in the{" "}
                <Link href={`/projects/${projectId}/wbs`} className="font-medium text-primary-text hover:underline focus-ring">
                  work breakdown
                </Link>
                .
              </p>
            ) : null}
          </div>
        </details>
      ) : null}

      {canArchive && canArchiveProjectStatus(status) ? (
        <div className="flex flex-col gap-3 rounded-lg border border-border p-4 sm:flex-row sm:items-center sm:justify-between sm:gap-6">
          <div className="flex min-w-0 flex-col gap-0.5">
            <p className="text-sm font-medium text-foreground">{isArchived ? "Archived" : "Archive project"}</p>
            <p className="text-[13px] leading-5 text-muted-foreground">
              {isArchived
                ? "Hidden from the default project list. Unarchive it to show it again."
                : "Hides this closed project from the default project list. Nothing is deleted."}
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            className="w-full shrink-0 sm:w-auto"
            onClick={() => toggleArchive(!isArchived)}
            loading={pending === "archive"}
            disabled={pending !== null}
          >
            {isArchived ? <ArchiveRestore aria-hidden /> : <Archive aria-hidden />}
            {isArchived ? "Unarchive" : "Archive"}
          </Button>
        </div>
      ) : null}

      <Modal
        open={reasonFor !== null}
        onOpenChange={(open) => {
          if (!open && pending === null) setReasonFor(null);
        }}
        dismissible={false}
        title={cancelling ? `Cancel "${projectName}"?` : `Put "${projectName}" on hold?`}
        description={
          cancelling
            ? "Cancelling is final: the project can't be reopened, only archived. Everyone on it is notified with your reason."
            : "Everyone on the project is notified with your reason. You can resume it at any time."
        }
        footer={
          <>
            <Button variant="outline" onClick={() => setReasonFor(null)} disabled={pending !== null}>
              {cancelling ? "Keep project" : "Back"}
            </Button>
            <Button
              type="submit"
              form={`${reasonId}-form`}
              variant={cancelling ? "danger" : "primary"}
              loading={pending !== null && pending !== "archive"}
            >
              {cancelling ? "Cancel project" : "Put on hold"}
            </Button>
          </>
        }
      >
        <form id={`${reasonId}-form`} onSubmit={submitReason} noValidate className="flex flex-col gap-3">
          <Field
            label="Reason"
            required
            error={reasonError ?? undefined}
            hint={cancelling ? "e.g. \"Client terminated the contract\"" : "e.g. \"Waiting for the barangay permit\""}
          >
            <Textarea
              value={reason}
              onChange={(event) => {
                setReason(event.target.value);
                if (reasonError) setReasonError(null);
              }}
              rows={3}
              maxLength={500}
              autoFocus
            />
          </Field>
          <p className="text-right text-xs text-muted-foreground tabular-nums">{reason.length}/500</p>
        </form>
      </Modal>
    </div>
  );
}
