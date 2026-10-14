"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Ban, Copy, KeyRound, Plus } from "lucide-react";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { Modal } from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { Field } from "@/components/ui/field";
import { FormError } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "@/components/ui/toaster";
import { diffDays, todayInManila, type ISODate } from "@/lib/domain/dates";
import { formatDate, pluralize } from "@/lib/domain/format";
import { cn } from "@/lib/utils";
import { createProjectInviteCode, revokeProjectInviteCode } from "@/server/actions/collaborators";
import type { InviteCodeState, ProjectInviteCode } from "@/server/queries/collaborators";
import { copyToClipboard } from "./copy";

const EXPIRY_OPTIONS = [
  { value: "none", label: "Never expires" },
  { value: "1", label: "1 day" },
  { value: "7", label: "7 days" },
  { value: "30", label: "30 days" },
  { value: "90", label: "90 days" },
] as const;

const STATE_BADGE: Record<InviteCodeState, { label: string; tone: BadgeTone }> = {
  active: { label: "Active", tone: "success" },
  expired: { label: "Expired", tone: "warning" },
  exhausted: { label: "Used up", tone: "neutral" },
  revoked: { label: "Turned off", tone: "neutral" },
};

function usageText(code: ProjectInviteCode): string {
  if (code.maxUses === null) return `${pluralize(code.useCount, "use")} · no limit`;
  return `${code.useCount} of ${pluralize(code.maxUses, "use")}`;
}

function expiryText(code: ProjectInviteCode, today: ISODate): string {
  if (code.state === "revoked" && code.revokedAt) return `Turned off ${formatDate(todayInManila(new Date(code.revokedAt)))}`;
  if (!code.expiresAt) return "Never expires";
  const day = todayInManila(new Date(code.expiresAt));
  if (code.state === "expired") return `Expired ${formatDate(day)}`;
  const days = diffDays(day, today);
  if (days <= 0) return "Expires today";
  if (days === 1) return "Expires tomorrow";
  return `Expires ${formatDate(day)}`;
}

/**
 * Project invite codes (D11): inspectors type the code during onboarding (or from "No company
 * yet") to join this project. Create with optional expiry and usage limit, copy, turn off.
 */
export function InviteCodesPanel({
  projectId,
  codes,
  today,
}: {
  projectId: string;
  codes: ProjectInviteCode[];
  today: ISODate;
}) {
  const router = useRouter();
  const confirm = useConfirm();
  const [open, setOpen] = useState(false);
  const [expiry, setExpiry] = useState<string>("7");
  const [maxUses, setMaxUses] = useState("");
  const [maxUsesError, setMaxUsesError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [revoking, setRevoking] = useState<string | null>(null);

  function openDialog() {
    setExpiry("7");
    setMaxUses("");
    setMaxUsesError(null);
    setFormError(null);
    setOpen(true);
  }

  async function create(event: React.FormEvent) {
    event.preventDefault();
    const trimmed = maxUses.trim();
    const uses = trimmed === "" ? null : Number(trimmed);
    if (uses !== null && (!Number.isInteger(uses) || uses < 1 || uses > 1000)) {
      setMaxUsesError("Enter a whole number from 1 to 1,000, or leave it empty for no limit.");
      return;
    }
    setCreating(true);
    const result = await createProjectInviteCode({
      projectId,
      expiresInDays: expiry === "none" ? null : Number(expiry),
      maxUses: uses,
    });
    setCreating(false);
    if (!result.ok) {
      if (result.error.fieldErrors?.maxUses) setMaxUsesError(result.error.fieldErrors.maxUses);
      else setFormError(result.error.message);
      return;
    }
    setOpen(false);
    router.refresh();
    toast.success(`Invite code ${result.data.code} created`, {
      description: "Share it with inspectors; they enter it when they join.",
      action: { label: "Copy", onClick: () => void copyToClipboard(result.data.code, "Invite code copied") },
    });
  }

  async function revoke(code: ProjectInviteCode) {
    const ok = await confirm({
      title: `Turn off code ${code.code}?`,
      description: `Nobody new can join with it. ${
        code.useCount > 0 ? `The ${pluralize(code.useCount, "person", "people")} who already joined keep their access.` : ""
      }`.trim(),
      tone: "danger",
      confirmLabel: "Turn off code",
    });
    if (!ok) return;
    setRevoking(code.id);
    const result = await revokeProjectInviteCode({ projectId, codeId: code.id });
    setRevoking(null);
    if (!result.ok) {
      toast.error("Couldn't turn off the code", { description: result.error.message });
      return;
    }
    toast.success(`Code ${code.code} turned off`);
    router.refresh();
  }

  const active = codes.filter((code) => code.state === "active");
  const inactive = codes.filter((code) => code.state !== "active");

  return (
    <div className="flex flex-col">
      {codes.length === 0 ? (
        <EmptyState
          variant="plain"
          size="sm"
          icon={<KeyRound />}
          title="No invite codes yet"
          description="Create a code to let inspectors join this project without an email invitation."
          headingLevel="h3"
          action={
            <Button variant="outline" onClick={openDialog}>
              <Plus aria-hidden />
              Create invite code
            </Button>
          }
        />
      ) : (
        <>
          <ul className="flex flex-col divide-y divide-border">
            {[...active, ...inactive].map((code) => {
              const badge = STATE_BADGE[code.state];
              const isActive = code.state === "active";
              return (
                <li key={code.id} className={cn("flex flex-wrap items-center gap-x-4 gap-y-3 px-5 py-3.5 sm:px-6", !isActive && "bg-surface-muted/60")}>
                  <div className="flex min-w-0 flex-1 items-center gap-3">
                    <span
                      className={cn(
                        "rounded-md border px-3 py-1.5 font-mono text-[15px] font-semibold tracking-[0.12em] tabular-nums",
                        isActive ? "border-border-strong bg-surface-sunken text-foreground" : "border-border text-muted-foreground line-through",
                      )}
                    >
                      {code.code}
                    </span>
                    <div className="flex min-w-0 flex-col gap-0.5">
                      <span className="flex flex-wrap items-center gap-2">
                        <Badge size="sm" tone={badge.tone}>
                          {badge.label}
                        </Badge>
                        <span className="text-xs text-muted-foreground tabular-nums">{usageText(code)}</span>
                      </span>
                      <span className="text-xs leading-4 text-muted-foreground">
                        {expiryText(code, today)}
                        {code.createdByName ? ` · by ${code.createdByName}` : ""}
                      </span>
                    </div>
                  </div>
                  {isActive ? (
                    <div className="flex w-full shrink-0 gap-2 sm:w-auto">
                      <Button variant="outline" size="sm" className="flex-1 max-sm:h-11 sm:flex-none" onClick={() => copyToClipboard(code.code, "Invite code copied")}>
                        <Copy aria-hidden />
                        Copy
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="flex-1 text-danger-text hover:bg-danger-soft hover:text-danger-text max-sm:h-11 sm:flex-none"
                        onClick={() => revoke(code)}
                        loading={revoking === code.id}
                        disabled={revoking !== null}
                      >
                        <Ban aria-hidden />
                        Turn off
                      </Button>
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
          <div className="border-t border-border px-5 py-3.5 sm:px-6">
            <Button variant="outline" size="sm" className="max-sm:h-11" onClick={openDialog}>
              <Plus aria-hidden />
              Create invite code
            </Button>
          </div>
        </>
      )}

      <Modal
        open={open}
        onOpenChange={(next) => !creating && setOpen(next)}
        title="Create an invite code"
        description="Inspectors who enter this code join this project (and your company) as Inspector / QA / QC."
        size="sm"
        footer={
          <>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={creating}>
              Cancel
            </Button>
            <Button type="submit" form="create-invite-code" loading={creating} loadingText="Creating…">
              Create code
            </Button>
          </>
        }
      >
        <form id="create-invite-code" onSubmit={create} noValidate className="flex flex-col gap-5">
          <FormError>{formError}</FormError>
          <Field label="Expires after" hint="After this, the code stops working. People who joined keep access.">
            <Select value={expiry} onValueChange={setExpiry}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {EXPIRY_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Usage limit" hint="Leave empty for no limit." error={maxUsesError ?? undefined}>
            <Input
              value={maxUses}
              onChange={(event) => {
                setMaxUses(event.target.value);
                if (maxUsesError) setMaxUsesError(null);
              }}
              inputMode="numeric"
              placeholder="e.g. 5"
              className="tabular-nums"
            />
          </Field>
        </form>
      </Modal>
    </div>
  );
}
