"use server";

/**
 * Collaborators mutations (spec §4.4, D11): invite by email (+ the Brevo invitation email), resend,
 * revoke, remove a member, and project invite codes. The RPCs check that the caller manages the
 * project; these actions validate input, send the email and map errors to plain language.
 */
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { fail, failFrom, failWith, fromZodError, ok, runAction, type ActionResult } from "@/lib/action-result";
import type { ProjectRole } from "@/lib/domain";
import { inviteSchema } from "@/lib/domain/schemas";
import { isReservedEmailDomain, sendInvitationEmail, type InvitationRpcResult } from "@/lib/email";
import { serverEnv } from "@/lib/env";
import { unexpectedError } from "@/lib/errors";
import { createClient } from "@/lib/supabase/server";
import { queueEmailDispatch } from "@/server/email-dispatch";

const projectId = z.uuid({ error: "This project link is not valid. Reload the page." });

function revalidateCollaborators(id: string): void {
  revalidatePath(`/projects/${id}/collaborators`);
}

/** How the invitation reached the person. */
export type InviteDelivery =
  /** Brevo accepted the email (sandbox mode validates and drops it). */
  | "emailed"
  /** They already have an account: an in-app notification (and an email through the outbox). */
  | "in_app"
  /** No email went out; share the link yourself. */
  | "not_sent";

export interface InviteOutcome {
  invitationId: string;
  email: string;
  role: ProjectRole;
  resent: boolean;
  existingUser: boolean;
  delivery: InviteDelivery;
  /** Plain-language reason when `delivery` is `not_sent`. */
  deliveryNote: string | null;
  /** The invitation link (`/invite/<token>`), valid until the invitation is resent or expires. */
  inviteLink: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toInvitationResult(data: unknown): InvitationRpcResult | null {
  if (!isRecord(data)) return null;
  const { invitation_id, token, email, role } = data;
  if (typeof invitation_id !== "string" || typeof token !== "string" || typeof email !== "string" || typeof role !== "string") {
    return null;
  }
  return {
    invitation_id,
    token,
    email,
    role,
    resent: data.resent === true,
    existing_user: data.existing_user === true,
    company_name: typeof data.company_name === "string" ? data.company_name : "",
    project_name: typeof data.project_name === "string" ? data.project_name : "",
    inviter_name: typeof data.inviter_name === "string" ? data.inviter_name : null,
    expires_at: typeof data.expires_at === "string" ? data.expires_at : "",
  };
}

/** Sends (or queues) the email for a fresh token and describes what happened. */
async function deliver(invite: InvitationRpcResult): Promise<InviteOutcome> {
  const appUrl = serverEnv().appUrl;
  const base: Omit<InviteOutcome, "delivery" | "deliveryNote"> = {
    invitationId: invite.invitation_id,
    email: invite.email,
    role: invite.role === "pm" ? "pm" : "inspector",
    resent: invite.resent,
    existingUser: invite.existing_user,
    inviteLink: `${appUrl}/invite/${encodeURIComponent(invite.token)}`,
  };

  if (invite.existing_user) {
    // The database queued an `invitation_received` notification; its email goes through the outbox.
    queueEmailDispatch();
    return { ...base, delivery: "in_app", deliveryNote: null };
  }

  const sent = await sendInvitationEmail(invite);
  if (sent.ok) return { ...base, delivery: "emailed", deliveryNote: null };

  let deliveryNote = "We couldn't send the email just now. Copy the invitation link and share it yourself.";
  if (isReservedEmailDomain(invite.email)) {
    deliveryNote = "This is a test address that can't receive email. Copy the invitation link instead.";
  } else if (sent.skipped) {
    deliveryNote = "Email isn't set up for this workspace yet. Copy the invitation link and share it yourself.";
  } else {
    console.error("[collaborators] invitation email failed", sent.error);
  }
  return { ...base, delivery: "not_sent", deliveryNote };
}

const inviteInputSchema = z.object({ projectId }).and(inviteSchema);

/** Invites someone by email as PM or Inspector (spec §4.4) and emails them the link. */
export async function inviteCollaborator(input: {
  projectId: string;
  email: string;
  role: ProjectRole;
}): Promise<ActionResult<InviteOutcome>> {
  return runAction(async () => {
    const parsed = inviteInputSchema.safeParse(input);
    if (!parsed.success) return fromZodError(parsed.error);

    const supabase = await createClient();
    const { data, error } = await supabase.rpc("invite_to_project", {
      p_project_id: parsed.data.projectId,
      p_email: parsed.data.email,
      p_role: parsed.data.role,
    });
    if (error) {
      const failure = failFrom(error);
      // Invitee problems belong next to the email field.
      const fieldErrors =
        failure.error.fieldErrors ??
        (["CANNOT_INVITE_SELF", "INVITEE_IN_OTHER_COMPANY", "ALREADY_MEMBER"].includes(failure.error.code)
          ? { email: failure.error.message }
          : failure.error.code === "ROLE_NOT_ALLOWED"
            ? { role: failure.error.message }
            : undefined);
      const mapped = fieldErrors
        ? Object.fromEntries(Object.entries(fieldErrors).map(([key, message]) => [key === "p_email" ? "email" : key, message]))
        : undefined;
      return fail(failure.error.code, failure.error.message, mapped);
    }
    const invite = toInvitationResult(data);
    if (!invite) return failWith(unexpectedError(new Error("invite_to_project returned an unexpected result")));

    const outcome = await deliver(invite);
    revalidateCollaborators(parsed.data.projectId);
    return ok(outcome);
  });
}

const invitationRef = z.object({ projectId, invitationId: z.uuid({ error: "This invitation is not valid. Reload the page." }) });

/** Refreshes the token and expiry (7 days) and sends the email again. */
export async function resendInvitation(input: { projectId: string; invitationId: string }): Promise<ActionResult<InviteOutcome>> {
  return runAction(async () => {
    const parsed = invitationRef.safeParse(input);
    if (!parsed.success) return fromZodError(parsed.error);
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("resend_invitation", { p_invitation_id: parsed.data.invitationId });
    if (error) return failFrom(error);
    const invite = toInvitationResult(data);
    if (!invite) return failWith(unexpectedError(new Error("resend_invitation returned an unexpected result")));
    const outcome = await deliver({ ...invite, resent: true });
    revalidateCollaborators(parsed.data.projectId);
    return ok(outcome);
  });
}

/** Cancels a pending invitation; its link stops working. */
export async function revokeInvitation(input: { projectId: string; invitationId: string }): Promise<ActionResult<void>> {
  return runAction(async () => {
    const parsed = invitationRef.safeParse(input);
    if (!parsed.success) return fromZodError(parsed.error);
    const supabase = await createClient();
    const { error } = await supabase.rpc("revoke_invitation", { p_invitation_id: parsed.data.invitationId });
    if (error) return failFrom(error);
    revalidateCollaborators(parsed.data.projectId);
    return ok();
  });
}

/** Removes someone from this project only (they stay in the company; their log entries stay). */
export async function removeCollaborator(input: {
  projectId: string;
  userId: string;
}): Promise<ActionResult<{ removedSelf: boolean }>> {
  return runAction(async () => {
    const parsed = z.object({ projectId, userId: z.uuid({ error: "Reload the page and try again." }) }).safeParse(input);
    if (!parsed.success) return fromZodError(parsed.error);
    const supabase = await createClient();
    const { data: claims } = await supabase.auth.getClaims();
    const removedSelf = claims?.claims?.sub === parsed.data.userId;
    const { error } = await supabase.rpc("remove_project_member", {
      p_project_id: parsed.data.projectId,
      p_user_id: parsed.data.userId,
    });
    if (error) return failFrom(error);
    queueEmailDispatch();
    if (removedSelf) revalidatePath("/", "layout");
    else revalidateCollaborators(parsed.data.projectId);
    return ok({ removedSelf });
  });
}

const optionalPositiveInt = (max: number, message: string) =>
  z.preprocess(
    (value) => (value === "" || value === null || value === undefined ? null : Number(value)),
    z.number({ error: message }).int(message).min(1, message).max(max, message).nullable(),
  );

const createCodeSchema = z.object({
  projectId,
  expiresInDays: optionalPositiveInt(365, "Choose an expiry between 1 and 365 days, or no expiry."),
  maxUses: optionalPositiveInt(1000, "Enter a usage limit between 1 and 1,000, or leave it empty for no limit."),
});

export interface CreatedInviteCode {
  id: string;
  code: string;
}

/** Creates a project invite code for inspectors (D11). */
export async function createProjectInviteCode(input: {
  projectId: string;
  expiresInDays: number | null;
  maxUses: number | null;
}): Promise<ActionResult<CreatedInviteCode>> {
  return runAction(async () => {
    const parsed = createCodeSchema.safeParse(input);
    if (!parsed.success) return fromZodError(parsed.error);
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("create_invite_code", {
      p_project_id: parsed.data.projectId,
      p_expires_in_days: parsed.data.expiresInDays ?? undefined,
      p_max_uses: parsed.data.maxUses ?? undefined,
    });
    if (error) return failFrom(error);
    revalidateCollaborators(parsed.data.projectId);
    return ok({ id: data.id, code: data.code });
  });
}

/** Turns a code off; people who already joined keep their access. */
export async function revokeProjectInviteCode(input: { projectId: string; codeId: string }): Promise<ActionResult<void>> {
  return runAction(async () => {
    const parsed = z.object({ projectId, codeId: z.uuid({ error: "Reload the page and try again." }) }).safeParse(input);
    if (!parsed.success) return fromZodError(parsed.error);
    const supabase = await createClient();
    const { error } = await supabase.rpc("revoke_invite_code", { p_id: parsed.data.codeId });
    if (error) return failFrom(error);
    revalidateCollaborators(parsed.data.projectId);
    return ok();
  });
}
