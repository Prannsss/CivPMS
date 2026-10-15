"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Ban, Copy, KeyRound, Plus } from "lucide-react";
import { SettingsCard } from "@/components/profile/settings-layout";
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
import { createCompanyInviteCode, revokeCompanyInviteCode } from "@/server/actions/company";
import type { CompanyInviteCode, InviteCodeState } from "@/server/queries/company";

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

async function copyCode(code: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(code);
    toast.success("Invite code copied", { description: "Share it with the inspector; they enter it when they join." });
  } catch {
    toast.error("Couldn't copy automatically", { description: `Select and copy it yourself: ${code}` });
  }
}

function usageText(code: CompanyInviteCode): string {
  if (code.maxUses === null) return `${pluralize(code.useCount, "use")} · no limit`;
  return `${code.useCount} of ${pluralize(code.maxUses, "use")}`;
}

function expiryText(code: CompanyInviteCode, today: ISODate): string {
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
 * Company-wide invite codes (D11): an inspector who enters one joins the company (no project
 * yet; a PM then adds them to projects). Owner PM and company PMs can create, copy and turn off.
 */
export function CompanyInviteCodes({ codes, today }: { codes: CompanyInviteCode[]; today: ISODate }) {
  const router = useRouter();
  const confirm = useConfirm();
  const [open, setOpen] = useState(false);
  const [expiry, setExpiry] = useState<string>("7");
  const [maxUsesError, setMaxUsesError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [revoking, setRevoking] = useState<string | null>(null);

  function openDialog() {
    setExpiry("7");
    setMaxUsesError(null);
    setFormError(null);
    setOpen(true);
  }

  async function create(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const raw = String(new FormData(event.currentTarget).get("maxUses") ?? "").trim();
    const uses = raw === "" ? null : Number(raw.replace(/,/g, ""));
    if (uses !== null && (!Number.isInteger(uses) || uses < 1 || uses > 1000)) {
      setMaxUsesError("Enter a whole number from 1 to 1,000, or leave it empty for no limit.");
      return;
    }
    setCreating(true);
    const result = await createCompanyInviteCode({ expiresInDays: expiry === "none" ? null : Number(expiry), maxUses: uses });
    setCreating(false);
    if (!result.ok) {
      if (result.error.fieldErrors?.maxUses) setMaxUsesError(result.error.fieldErrors.maxUses);
      else setFormError(result.error.message);
      return;
    }
    setOpen(false);
    router.refresh();
    toast.success(`Invite code ${result.data.code} created`, {
      description: "Inspectors enter it when they sign up or from “No company yet”.",
      action: { label: "Copy", onClick: () => void copyCode(result.data.code) },
    });
  }

  async function revoke(code: CompanyInviteCode) {
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
    const result = await revokeCompanyInviteCode({ codeId: code.id });
    setRevoking(null);
    if (!result.ok) {
      toast.error("Couldn't turn off the code", { description: result.error.message });
      return;
    }
    toast.success(`Code ${code.code} turned off`);
    router.refresh();
  }

  const activeCount = codes.filter((code) => code.state === "active").length;

  return (
    <SettingsCard
      id="invite-codes"
      title="Company invite codes"
      description="For inspectors: entering a code joins your company, without an email invitation. Then add them to projects from Collaborators."
      actions={
        codes.length > 0 ? (
          <Button variant="outline" size="sm" className="max-sm:h-11" onClick={openDialog}>
            <Plus aria-hidden />
            New code
          </Button>
        ) : null
      }
      flush
    >
      {codes.length === 0 ? (
        <div className="px-5 pb-5 sm:px-6">
          <EmptyState
            variant="dashed"
            size="sm"
            icon={<KeyRound />}
            title="No company invite codes yet"
            description="Create a code, share it with an inspector, and they join your company when they enter it."
            headingLevel="h3"
            action={
              <Button variant="outline" onClick={openDialog}>
                <Plus aria-hidden />
                Create invite code
              </Button>
            }
          />
        </div>
      ) : (
        <>
          <p className="sr-only" aria-live="polite">
            {pluralize(activeCount, "active code")}
          </p>
          <ul className="flex flex-col divide-y divide-border border-t border-border">
            {codes.map((code) => {
              const badge = STATE_BADGE[code.state];
              const isActive = code.state === "active";
              return (
                <li
                  key={code.id}
                  data-testid={`invite-code-${code.code}`}
                  className={cn("flex flex-wrap items-center gap-x-4 gap-y-3 px-5 py-3.5 sm:px-6", !isActive && "bg-surface-muted/60")}
                >
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
                      <Button variant="outline" size="sm" className="flex-1 max-sm:h-11 sm:flex-none" onClick={() => void copyCode(code.code)}>
                        <Copy aria-hidden />
                        Copy
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="flex-1 text-danger-text hover:bg-danger-soft hover:text-danger-text max-sm:h-11 sm:flex-none"
                        onClick={() => void revoke(code)}
                        loading={revoking === code.id}
                        disabled={revoking !== null}
                        aria-label={`Turn off code ${code.code}`}
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
        </>
      )}

      <Modal
        open={open}
        onOpenChange={(next) => !creating && setOpen(next)}
        title="Create a company invite code"
        description="Inspectors who enter this code join your company as Inspector / QA / QC. Add them to projects afterwards."
        size="sm"
        footer={
          <>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={creating}>
              Cancel
            </Button>
            <Button type="submit" form="create-company-code" loading={creating} loadingText="Creating…">
              Create code
            </Button>
          </>
        }
      >
        <form id="create-company-code" onSubmit={create} noValidate className="flex flex-col gap-5">
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
          <Field label="Usage limit" hint="How many people can join with it. Leave empty for no limit." error={maxUsesError ?? undefined}>
            <Input
              name="maxUses"
              defaultValue=""
              onChange={() => maxUsesError && setMaxUsesError(null)}
              inputMode="numeric"
              placeholder="e.g. 5"
              className="tabular-nums"
            />
          </Field>
        </form>
      </Modal>
    </SettingsCard>
  );
}
