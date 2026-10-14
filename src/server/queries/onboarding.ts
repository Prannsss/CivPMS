import "server-only";

/**
 * Reads for onboarding (spec §4.1–4.3, D10–D12) and the email-invitation landing page (§4.4).
 * Everything runs as the visitor (RLS); `get_invitation_by_token` also works signed out.
 */
import { cache } from "react";
import type { ProjectRole } from "@/lib/domain/permissions";
import { AppException, toAppError } from "@/lib/errors";
import { createClient } from "@/lib/supabase/server";
import { getSessionContext, type CompanyMembership } from "@/server/context";
import { getMyPendingInvitations, type PendingInvitation } from "@/server/queries/invitations";

export type OnboardingRole = "pm" | "inspector";

export interface OnboardingState {
  userId: string;
  email: string;
  /** From the profile (Google sign-ups get their Google name here automatically). */
  fullName: string;
  rolePref: OnboardingRole | null;
  onboarded: boolean;
  membership: CompanyMembership | null;
  invitations: PendingInvitation[];
}

function isRole(value: unknown): value is OnboardingRole {
  return value === "pm" || value === "inspector";
}

/** The signed-in visitor's onboarding state, or null without a session. */
export const getOnboardingState = cache(async (): Promise<OnboardingState | null> => {
  const pending = getMyPendingInvitations();
  pending.catch(() => undefined);
  const context = await getSessionContext();
  if (!context.user) return null;
  const invitations = await pending;
  return {
    userId: context.user.id,
    email: context.profile?.email ?? context.user.email ?? "",
    fullName: context.profile?.full_name?.trim() ?? "",
    rolePref: isRole(context.profile?.role_pref) ? context.profile.role_pref : null,
    onboarded: !context.needsOnboarding,
    membership: context.membership,
    invitations,
  };
});

// ---------------------------------------------------------------------------
// Invitation landing (/invite/[token])
// ---------------------------------------------------------------------------

export type InvitationStatus = "pending" | "accepted" | "declined" | "expired" | "revoked";

export interface InvitationPreview {
  companyName: string;
  projectName: string;
  role: ProjectRole;
  inviterName: string;
  /** The invited address, masked: "j***@gmail.com". */
  emailHint: string;
  status: InvitationStatus;
  /** ISO timestamp. */
  expiresAt: string | null;
  /** False when the project was deleted after the invitation was sent. */
  projectAvailable: boolean;
}

const TOKEN_PATTERN = /^[0-9a-f]{64}$/i;
const STATUSES: readonly InvitationStatus[] = ["pending", "accepted", "declined", "expired", "revoked"];

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/** Looks a token up (signed in or not). Returns null for malformed or unknown tokens. */
export const getInvitationPreview = cache(async (token: string): Promise<InvitationPreview | null> => {
  if (!TOKEN_PATTERN.test(token)) return null;
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_invitation_by_token", { p_token: token });
  if (error) {
    const appError = toAppError(error);
    if (appError.code === "NOT_FOUND") return null;
    throw new AppException(appError.code, appError.message, { cause: error });
  }
  if (typeof data !== "object" || data === null || Array.isArray(data)) return null;
  const row = data as Record<string, unknown>;
  const status = STATUSES.find((candidate) => candidate === row.status) ?? "revoked";
  return {
    companyName: str(row.company_name),
    projectName: str(row.project_name),
    role: row.role === "pm" ? "pm" : "inspector",
    inviterName: str(row.inviter_name) || "Your Project Manager",
    emailHint: str(row.email_hint),
    status: row.expired === true ? "expired" : status,
    expiresAt: typeof row.expires_at === "string" ? row.expires_at : null,
    projectAvailable: row.project_available !== false,
  };
});
