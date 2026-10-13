"use server";

/**
 * Joining a company from the invitee's side (spec §4.3–4.4, D11, D12): invite codes and email
 * invitations. Shared by onboarding and the home "No company yet" state.
 *
 * - `previewInviteCode` shows "Join <Company> · <Project>?" before anything changes. It counts
 *   as an attempt for rate limiting (10 failed attempts per hour, enforced by the database).
 * - `redeemInviteCode` joins the company (and the project for project codes) as an inspector.
 *   Code problems come back as `{ ok: false, error_code }` from the RPC (so the failed attempt is
 *   kept); they are mapped to the same ActionResult failures as raised errors.
 * - `acceptInvitation` / `declineInvitation` take `{ invitationId }` (signed-in lists) or
 *   `{ token }` (the /invite/[token] landing page).
 */
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { failFrom, failWith, fromZodError, ok, runAction, type ActionResult } from "@/lib/action-result";
import type { ProjectRole } from "@/lib/domain/permissions";
import { redeemInviteCodeSchema } from "@/lib/domain/schemas";
import { DEFAULT_MESSAGES, errorFromRpcResult, isErrorCode, unexpectedError } from "@/lib/errors";
import { createClient } from "@/lib/supabase/server";

// ---------------------------------------------------------------------------
// Invite codes
// ---------------------------------------------------------------------------

export interface InviteCodePreview {
  /** Canonical `XXXX-XXXX`. */
  code: string;
  companyName: string;
  /** Set for project codes; null for company-wide codes. */
  projectName: string | null;
  scope: "company" | "project";
}

export interface JoinResult {
  companyId: string;
  companyName: string;
  projectId: string | null;
  projectName: string | null;
  /** The invite code: true when the user already had everything the code grants. */
  alreadyMember: boolean;
  /** Where to send the user next: the project when there is one, else home. */
  redirectTo: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function str(value: unknown): string | null {
  return typeof value === "string" && value !== "" ? value : null;
}

function landingPath(projectId: string | null): string {
  return projectId ? `/projects/${projectId}` : "/";
}

/** Checks a code and returns what it would join, without joining. */
export async function previewInviteCode(input: { code: string }): Promise<ActionResult<InviteCodePreview>> {
  return runAction(async () => {
    const parsed = redeemInviteCodeSchema.safeParse(input);
    if (!parsed.success) return fromZodError(parsed.error);

    const supabase = await createClient();
    const { data, error } = await supabase.rpc("preview_invite_code", { p_code: parsed.data.code });
    if (error) return failFrom(error);
    if (!isRecord(data)) return failWith(unexpectedError(new Error("preview_invite_code returned no object")));

    if (data.valid !== true) {
      const reason = data.reason;
      const code = isErrorCode(reason) ? reason : "INVALID_CODE";
      return failWith({ code, message: str(data.message) ?? DEFAULT_MESSAGES[code], field: "code" });
    }

    const companyName = str(data.company_name);
    if (!companyName) return failWith(unexpectedError(new Error("preview_invite_code returned no company")));
    return ok({
      code: str(data.code) ?? parsed.data.code,
      companyName,
      projectName: str(data.project_name),
      scope: data.scope === "project" ? "project" : "company",
    });
  });
}

/** Joins with a code (as an inspector). */
export async function redeemInviteCode(input: { code: string }): Promise<ActionResult<JoinResult>> {
  return runAction(async () => {
    const parsed = redeemInviteCodeSchema.safeParse(input);
    if (!parsed.success) return fromZodError(parsed.error);

    const supabase = await createClient();
    const { data, error } = await supabase.rpc("redeem_invite_code", { p_code: parsed.data.code });
    if (error) return failFrom(error);
    const failure = errorFromRpcResult(data, { field: "code" });
    if (failure) return failWith(failure);
    if (!isRecord(data)) return failWith(unexpectedError(new Error("redeem_invite_code returned no object")));

    const companyId = str(data.company_id);
    const companyName = str(data.company_name);
    if (!companyId || !companyName) return failWith(unexpectedError(new Error("redeem_invite_code returned no company")));
    const projectId = str(data.project_id);

    revalidatePath("/", "layout");
    return ok({
      companyId,
      companyName,
      projectId,
      projectName: str(data.project_name),
      alreadyMember: data.already_member === true,
      redirectTo: landingPath(projectId),
    });
  });
}

// ---------------------------------------------------------------------------
// Email invitations
// ---------------------------------------------------------------------------

const invitationRefSchema = z.union([
  z.object({ invitationId: z.uuid({ error: "This invitation link is not valid." }) }),
  z.object({
    token: z
      .string({ error: "This invitation link is not valid." })
      .trim()
      .regex(/^[A-Za-z0-9_-]{16,256}$/, "This invitation link is not valid."),
  }),
]);

export type InvitationRef = { invitationId: string } | { token: string };

export interface AcceptedInvitation {
  companyId: string;
  companyName: string;
  projectId: string;
  projectName: string;
  role: ProjectRole;
  /** The project the user just joined. */
  redirectTo: string;
}

function rpcRefArgs(ref: z.output<typeof invitationRefSchema>): { p_invitation_id?: string; p_token?: string } {
  return "invitationId" in ref ? { p_invitation_id: ref.invitationId } : { p_token: ref.token };
}

/** Accepts an email invitation: joins the company and the project. */
export async function acceptInvitation(input: InvitationRef): Promise<ActionResult<AcceptedInvitation>> {
  return runAction(async () => {
    const parsed = invitationRefSchema.safeParse(input);
    if (!parsed.success) return fromZodError(parsed.error);

    const supabase = await createClient();
    const { data, error } = await supabase.rpc("accept_invitation", rpcRefArgs(parsed.data));
    if (error) return failFrom(error);
    if (!isRecord(data)) return failWith(unexpectedError(new Error("accept_invitation returned no object")));

    const companyId = str(data.company_id);
    const companyName = str(data.company_name);
    const projectId = str(data.project_id);
    const projectName = str(data.project_name);
    if (!companyId || !companyName || !projectId || !projectName) {
      return failWith(unexpectedError(new Error("accept_invitation returned an incomplete result")));
    }

    revalidatePath("/", "layout");
    return ok({
      companyId,
      companyName,
      projectId,
      projectName,
      role: data.role === "pm" ? "pm" : "inspector",
      redirectTo: landingPath(projectId),
    });
  });
}

/** Declines an email invitation (the inviter is notified). */
export async function declineInvitation(input: InvitationRef): Promise<ActionResult<void>> {
  return runAction(async () => {
    const parsed = invitationRefSchema.safeParse(input);
    if (!parsed.success) return fromZodError(parsed.error);

    const supabase = await createClient();
    const { error } = await supabase.rpc("decline_invitation", rpcRefArgs(parsed.data));
    if (error) return failFrom(error);

    revalidatePath("/", "layout");
    return ok();
  });
}
