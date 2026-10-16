import "server-only";

/**
 * Company settings reads (spec §2.2, §4.4, D11, D13), as the signed-in user. RLS decides what
 * comes back: company members can read the company, its members and their profiles; company-wide
 * invite codes are visible to the Owner PM and PMs; invitations only on projects the caller
 * manages. Project counts are exact for the Owner PM (who sees every project).
 */
import { cache } from "react";
import type { CompanyRole, ProjectRole } from "@/lib/domain";
import { AppException, toAppError } from "@/lib/errors";
import { createClient } from "@/lib/supabase/server";

export interface CompanyInfo {
  id: string;
  name: string;
  workDays: number[];
  hoursPerDay: number;
  ownerId: string;
  ownerName: string | null;
  createdAt: string;
}

export interface CompanyMember {
  userId: string;
  name: string;
  email: string | null;
  avatarUrl: string | null;
  role: CompanyRole;
  /** Projects they are a member of (non-deleted). The Owner PM sees every project: null. */
  projectCount: number | null;
  joinedAt: string;
}

export type InviteCodeState = "active" | "expired" | "exhausted" | "revoked";

export interface CompanyInviteCode {
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

export interface CompanyPendingInvitation {
  id: string;
  email: string;
  role: ProjectRole;
  projectId: string | null;
  projectName: string | null;
  invitedByName: string | null;
  createdAt: string;
  expiresAt: string;
}

function throwReadFailure(error: unknown): never {
  const appError = toAppError(error);
  throw new AppException(appError.code, appError.message, { cause: error });
}

const ROLE_ORDER: Record<CompanyRole, number> = { owner_pm: 0, pm: 1, inspector: 2 };

export function sortMembers(list: CompanyMember[]): CompanyMember[] {
  return [...list].sort((a, b) => ROLE_ORDER[a.role] - ROLE_ORDER[b.role] || a.name.localeCompare(b.name, "en"));
}

export function inviteCodeState(
  code: { revoked_at: string | null; expires_at: string | null; max_uses: number | null; use_count: number },
  now: number,
): InviteCodeState {
  if (code.revoked_at) return "revoked";
  if (code.expires_at && new Date(code.expires_at).getTime() <= now) return "expired";
  if (code.max_uses !== null && code.use_count >= code.max_uses) return "exhausted";
  return "active";
}

export const getCompanyInfo = cache(async (companyId: string): Promise<CompanyInfo | null> => {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("companies")
    .select("id, name, default_work_days, default_hours_per_day, owner_id, created_at")
    .eq("id", companyId)
    .maybeSingle();
  if (error) throwReadFailure(error);
  if (!data) return null;
  const owner = await supabase.from("profiles").select("full_name, email").eq("id", data.owner_id).maybeSingle();
  if (owner.error) throwReadFailure(owner.error);
  return {
    id: data.id,
    name: data.name,
    workDays: [...(data.default_work_days ?? [])].sort((a, b) => a - b),
    hoursPerDay: Number(data.default_hours_per_day),
    ownerId: data.owner_id,
    ownerName: owner.data?.full_name?.trim() || owner.data?.email || null,
    createdAt: data.created_at,
  };
});

/** Everyone in the company with their role, join date and (for the Owner PM) project counts. */
export const getCompanyMembers = cache(async (companyId: string, withProjectCounts: boolean): Promise<CompanyMember[]> => {
  const supabase = await createClient();
  const members = await supabase
    .from("company_members")
    .select("user_id, role, created_at")
    .eq("company_id", companyId)
    .limit(1000);
  if (members.error) throwReadFailure(members.error);
  const ids = (members.data ?? []).map((m) => m.user_id);
  if (ids.length === 0) return [];

  const [profiles, memberships] = await Promise.all([
    supabase.from("profiles").select("id, full_name, email, avatar_url").in("id", ids),
    withProjectCounts
      ? supabase
          .from("project_members")
          .select("user_id, projects!inner(company_id, deleted_at)")
          .in("user_id", ids)
          .eq("projects.company_id", companyId)
          .is("projects.deleted_at", null)
          .limit(10000)
      : Promise.resolve({ data: [] as { user_id: string }[], error: null }),
  ]);
  if (profiles.error) throwReadFailure(profiles.error);
  if (memberships.error) throwReadFailure(memberships.error);

  const byId = new Map((profiles.data ?? []).map((p) => [p.id, p]));
  const counts = new Map<string, number>();
  for (const row of memberships.data ?? []) counts.set(row.user_id, (counts.get(row.user_id) ?? 0) + 1);

  return sortMembers(
    (members.data ?? []).map((m) => {
      const profile = byId.get(m.user_id);
      return {
        userId: m.user_id,
        name: profile?.full_name?.trim() || profile?.email || "Unnamed member",
        email: profile?.email ?? null,
        avatarUrl: profile?.avatar_url ?? null,
        role: m.role,
        projectCount: !withProjectCounts || m.role === "owner_pm" ? null : counts.get(m.user_id) ?? 0,
        joinedAt: m.created_at,
      };
    }),
  );
});

/** Company-wide codes (project_id is null): active first, then the 10 most recent inactive. */
export const getCompanyInviteCodes = cache(async (companyId: string): Promise<CompanyInviteCode[]> => {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("invite_codes")
    .select("id, code, created_at, expires_at, max_uses, use_count, revoked_at, creator:profiles!invite_codes_created_by_fkey(full_name)")
    .eq("company_id", companyId)
    .is("project_id", null)
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
  return [...codes.filter((c) => c.state === "active"), ...codes.filter((c) => c.state !== "active").slice(0, 10)];
});

/** Pending, unexpired email invitations on the projects the caller manages (newest first). */
export const getCompanyPendingInvitations = cache(async (companyId: string): Promise<CompanyPendingInvitation[]> => {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("invitations")
    .select(
      "id, email, role, project_id, created_at, expires_at, project:projects!invitations_project_id_fkey(name, deleted_at), inviter:profiles!invitations_invited_by_fkey(full_name)",
    )
    .eq("company_id", companyId)
    .eq("status", "pending")
    .gt("expires_at", new Date().toISOString())
    .order("created_at", { ascending: false })
    .limit(100);
  if (error) throwReadFailure(error);
  return (data ?? [])
    .filter((row) => !row.project?.deleted_at)
    .map((row) => ({
      id: row.id,
      email: row.email,
      role: row.role,
      projectId: row.project_id,
      projectName: row.project?.name ?? null,
      invitedByName: row.inviter?.full_name?.trim() || null,
      createdAt: row.created_at,
      expiresAt: row.expires_at,
    }));
});
