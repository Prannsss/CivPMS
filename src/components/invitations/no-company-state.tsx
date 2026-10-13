"use client";

import { useState } from "react";
import { Check, Copy, KeyRound, MailCheck } from "lucide-react";
import { toast } from "@/components/ui/toaster";
import { cn } from "@/lib/utils";
import { InviteCodeForm } from "./invite-code-form";
import { PendingInvitations, type PendingInvitation } from "./pending-invitations";

export type NoCompanyStateProps = {
  /** The signed-in user's email (what PMs should invite). */
  email: string;
  invitations: ReadonlyArray<PendingInvitation>;
  className?: string;
};

/**
 * "No company yet" (spec §4.3, D12): signed in and onboarded, but not part of a company. Shows
 * pending invitations first, the email to share with a PM, and invite-code entry.
 */
export function NoCompanyState({ email, invitations, className }: NoCompanyStateProps) {
  const [copied, setCopied] = useState(false);
  const hasInvitations = invitations.length > 0;

  async function copyEmail() {
    try {
      await navigator.clipboard.writeText(email);
      setCopied(true);
      toast.success("Email copied", { description: "Send it to your Project Manager." });
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("Couldn't copy", { description: "Select the email and copy it yourself." });
    }
  }

  return (
    <div className={cn("flex flex-col gap-8", className)} data-testid="no-company-state">
      <PendingInvitations
        invitations={invitations}
        heading="Invitations for you"
        description="Accept one to join the company and open the project."
      />

      <section
        aria-labelledby="no-company-heading"
        className="grid overflow-hidden rounded-xl border border-border bg-surface shadow-xs lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]"
      >
        <div className="flex flex-col gap-5 p-6 sm:p-8">
          <span
            aria-hidden
            className={cn(
              "grid place-items-center rounded-2xl bg-primary-soft text-primary-text",
              // With invitations above, this panel is the secondary path: keep it quieter.
              hasInvitations ? "size-11 ring-4 ring-primary-soft/40 [&_svg]:size-5" : "size-14 ring-8 ring-primary-soft/40 [&_svg]:size-7",
            )}
          >
            <MailCheck />
          </span>
          <div className="flex flex-col gap-2">
            <h2 id="no-company-heading" className={hasInvitations ? "text-h3 text-foreground" : "text-h2 text-foreground"}>
              {hasInvitations ? "Waiting for a different project?" : "You haven't been added to a project yet"}
            </h2>
            <p className="text-body-lg text-pretty text-muted-foreground">
              Ask your Project Manager to invite you using this email. Invitations show up here and in your
              notifications.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex h-11 max-w-full min-w-0 items-center rounded-full bg-surface-sunken px-4 text-sm font-medium text-foreground sm:h-10">
              <span className="truncate">{email}</span>
            </span>
            <button
              type="button"
              onClick={copyEmail}
              className="inline-flex h-11 items-center gap-1.5 rounded-full px-3 text-sm font-medium text-primary-text transition-colors hover:bg-primary-soft focus-ring sm:h-10"
            >
              {copied ? <Check aria-hidden className="size-4" /> : <Copy aria-hidden className="size-4" />}
              {copied ? "Copied" : "Copy email"}
            </button>
          </div>
        </div>

        <div className="relative flex flex-col gap-5 border-t border-border bg-surface-muted p-6 sm:p-8 lg:border-t-0 lg:border-l">
          <span
            aria-hidden
            className="absolute -top-3 left-1/2 grid h-6 -translate-x-1/2 place-items-center rounded-full border border-border bg-surface px-2.5 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase lg:top-1/2 lg:left-0 lg:-translate-y-1/2"
          >
            or
          </span>
          <div className="flex items-center gap-3">
            <span aria-hidden className="grid size-10 place-items-center rounded-xl bg-surface text-foreground shadow-xs ring-1 ring-border">
              <KeyRound className="size-5" />
            </span>
            <div className="flex flex-col">
              <h2 className="text-h3 text-foreground">Join with an invite code</h2>
              <p className="text-[13px] leading-5 text-muted-foreground">For inspectors, QA and QC. Your PM can share one.</p>
            </div>
          </div>
          <InviteCodeForm submitVariant={hasInvitations ? "outline" : "primary"} />
        </div>
      </section>
    </div>
  );
}
