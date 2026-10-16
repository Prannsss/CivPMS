import "server-only";

/**
 * Collaborators tab reads (spec §4.4, D11), as the signed-in user:
 * - members: `project_members` + profiles + company roles. The company's Owner PM always has access
 *   to every project, so they are listed even without a membership row.
 * - pending invitations and project invite codes: readable by managers only (RLS); others get [].
 */
import { cache } from "react";
import type { CompanyRole, ProjectRole } from "@/lib/domain";
import { AppException, toAppError } from "@/lib/errors";
import { createClient } from "@/lib/supabase/server";

export interface Collaborator {
  userId: string;
  name: string;
  email: string | null;
  avatarUrl: string | null;
  /** Null for the Owner PM when they have no membership row (they see every project anyway). */
  projectRole: ProjectRole | null;
  companyRole: CompanyRole | null;
  isOwner: boolean;
  /** When they joined the project (or the company, for the Owner PM without a row). */
  joinedAt: string;
}

export type InvitationState = "pending" | "expired";

export interface ProjectInvitation {
  id: string;
  email: string;
  role: ProjectRole;
  state: InvitationState;
  invitedByName: string | null;
  createdAt: string;
  expiresAt: string;
}

export type InviteCodeState = "active" | "expired" | "exhausted" | "revoked";

export interface ProjectInviteCode {
  id: string;
  code: string;
  state: InviteCodeState;
  createdAt: string;
  createdByName: string | null;
  expiresAt: string | null;
  maxUses: number | null;
  useCount: number;
  revokedAt: string | null;
}

function throwReadFailure(error: unknown): never {
  const appError = toAppError(error);
  throw new AppException(appError.code, appError.message, { cause: error });
}

const ROLE_ORDER: Record<string, number> = { owner_pm: 0, pm: 1, inspector: 2 };

/** Owner PM first, then PMs, then inspectors; alphabetical within a role. */
export function sortCollaborators(list: Collaborator[]): Collaborator[] {
  return [...list].sort((a, b) => {
    const ra = a.isOwner ? 0 : ROLE_ORDER[a.projectRole ?? "inspector"] ?? 3;
    const rb = b.isOwner ? 0 : ROLE_ORDER[b.projectRole ?? "inspector"] ?? 3;
    return ra - rb || a.name.localeCompare(b.name, "en");
  });
}

export const getCollaborators = cache(async (projectId: string, companyId: string): Promise<Collaborator[]> => {
  const supabase = await createClient();
  const [members, company] = await Promise.all([
    supabase
      .from("project_members")
      .select("user_id, role, created_at, profile:profiles!project_members_user_id_fkey(full_name, email, avatar_url)")
      .eq("project_id", projectId),
    supabase
      .from("company_members")
      .select("user_id, role, created_at, profile:profiles(full_name, email, avatar_url)")
      .eq("company_id", companyId),
  ]);
  if (members.error) throwReadFailure(members.error);
  if (company.error) throwReadFailure(company.error);

  const companyRoles = new Map<string, CompanyRole>();
  for (const row of company.data ?? []) companyRoles.set(row.user_id, row.role);

  const list: Collaborator[] = (members.data ?? []).map((row) => {
    const companyRole = companyRoles.get(row.user_id) ?? null;
    return {
      userId: row.user_id,
      name: row.profile?.full_name?.trim() || row.profile?.email || "Unnamed member",
      email: row.profile?.email ?? null,
      avatarUrl: row.profile?.avatar_url ?? null,
      projectRole: row.role,
      companyRole,
      isOwner: companyRole === "owner_pm",
      joinedAt: row.created_at,
    };
  });

  const owner = (company.data ?? []).find((row) => row.role === "owner_pm");
  if (owner && !list.some((member) => member.userId === owner.user_id)) {
    list.push({
      userId: owner.user_id,
      name: owner.profile?.full_name?.trim() || owner.profile?.email || "Owner PM",
      email: owner.profile?.email ?? null,
      avatarUrl: owner.profile?.avatar_url ?? null,
      projectRole: null,
      companyRole: "owner_pm",
      isOwner: true,
      joinedAt: owner.created_at,
    });
  }
  return sortCollaborators(list);
});

/** Pending (and expired, so they can be resent) invitations, newest first. Managers only. */
export const getProjectInvitations = cache(async (projectId: string): Promise<ProjectInvitation[]> => {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("invitations")
    .select("id, email, role, status, created_at, expires_at, inviter:profiles!invitations_invited_by_fkey(full_name)")
    .eq("project_id", projectId)
    .in("status", ["pending", "expired"])
    .order("created_at", { ascending: false })
    .limit(100);
  if (error) throwReadFailure(error);
  const now = Date.now();
  return (data ?? []).map((row) => ({
    id: row.id,
    email: row.email,
    role: row.role,
    state: row.status === "expired" || new Date(row.expires_at).getTime() <= now ? "expired" : "pending",
    invitedByName: row.inviter?.full_name?.trim() || null,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
  }));
});

export function inviteCodeState(
  code: { revoked_at: string | null; expires_at: string | null; max_uses: number | null; use_count: number },
  now: number,
): InviteCodeState {
  if (code.revoked_at) return "revoked";
  if (code.expires_at && new Date(code.expires_at).getTime() <= now) return "expired";
  if (code.max_uses !== null && code.use_count >= code.max_uses) return "exhausted";
  return "active";
}

/** This project's invite codes: active ones first, then the 10 most recent inactive ones. */
export const getProjectInviteCodes = cache(async (projectId: string): Promise<ProjectInviteCode[]> => {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("invite_codes")
    .select("id, code, created_at, expires_at, max_uses, use_count, revoked_at, creator:profiles!invite_codes_created_by_fkey(full_name)")
    .eq("project_id", projectId)
    .order("created_at", { ascending: false })
    .limit(100);
  if (error) throwReadFailure(error);
  const now = Date.now();
  const codes = (data ?? []).map((row) => ({
    id: row.id,
    code: row.code,
    state: inviteCodeState(row, now),
    createdAt: row.created_at,
    createdByName: row.creator?.full_name?.trim() || null,
    expiresAt: row.expires_at,
    maxUses: row.max_uses,
    useCount: row.use_count,
    revokedAt: row.revoked_at,
  }));
  const active = codes.filter((code) => code.state === "active");
  const inactive = codes.filter((code) => code.state !== "active").slice(0, 10);
  return [...active, ...inactive];
});
