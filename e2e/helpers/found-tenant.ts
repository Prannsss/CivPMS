/**
 * The e2e tenant for the app-foundation specs, kept apart from the demo company so tests never
 * change demo data: "[FOUND] QA Builders" (Owner PM found-owner@civpms.test) with one project, and
 * found-inspector@civpms.test in the "No company yet" state.
 *
 * `ensureFoundTenant()` creates whatever is missing through the app's own RPCs and resets the
 * inspector (removes their company membership, revokes pending invitations to them), so every
 * run starts from the same state. The two accounts come from supabase/seed/found-e2e.sql.
 */
import { ACCOUNTS, supabaseAs } from "./auth";

export const FOUND_COMPANY = "[FOUND] QA Builders";
export const FOUND_PROJECT = "[FOUND] Bell Test Project";
export const FOUND_OWNER_NAME = "[FOUND] Olivia Owner";
export const FOUND_INSPECTOR_NAME = "[FOUND] Ian Inspector";

export type FoundTenant = {
  ownerId: string;
  inspectorId: string;
  companyId: string;
  projectId: string;
};

type Result<T> = { data: T; error: { message: string; code?: string; details?: string } | null };

function check<T>(result: Result<T>, what: string): T {
  if (result.error) throw new Error(`${what} failed: ${result.error.code ?? ""} ${result.error.message} ${result.error.details ?? ""}`);
  return result.data;
}

/** Like `check`, for calls that must return a row. */
function must<T>(result: Result<T>, what: string): NonNullable<T> {
  const data = check(result, what);
  if (data === null || data === undefined) throw new Error(`${what} returned nothing`);
  return data;
}

export async function ensureFoundTenant(): Promise<FoundTenant> {
  const owner = await supabaseAs("foundOwner");
  const inspector = await supabaseAs("foundInspector");

  // Owner: profile + company.
  const ownerProfile = must(
    await owner.client.from("profiles").select("full_name, role_pref, onboarded_at").eq("id", owner.userId).single(),
    "read owner profile",
  );
  if (!ownerProfile.full_name || ownerProfile.role_pref !== "pm") {
    check(await owner.client.rpc("complete_profile", { p_full_name: FOUND_OWNER_NAME, p_role_pref: "pm" }), "complete_profile (owner)");
  }
  let membership = check(
    await owner.client.from("company_members").select("company_id, role").eq("user_id", owner.userId).maybeSingle(),
    "read owner membership",
  );
  if (!membership) {
    const company = must(await owner.client.rpc("create_company", { p_name: FOUND_COMPANY }), "create_company");
    membership = { company_id: company.id, role: "owner_pm" };
  }
  const companyId = membership.company_id;

  // Owner: the test project.
  let project = check(
    await owner.client.from("projects").select("id").eq("company_id", companyId).eq("name", FOUND_PROJECT).maybeSingle(),
    "read project",
  );
  if (!project) {
    const created = must(
      await owner.client.rpc("create_project", {
        p_name: FOUND_PROJECT,
        p_start_date: "2026-11-02",
        p_end_date: "2027-03-26",
        p_budget: 1_500_000,
        p_site_name: "[FOUND] Test site",
        p_color: "purple",
      }),
      "create_project",
    );
    project = { id: created.id };
  }

  // Inspector: profile, onboarded without a company.
  const inspectorProfile = must(
    await inspector.client.from("profiles").select("full_name, role_pref, onboarded_at").eq("id", inspector.userId).single(),
    "read inspector profile",
  );
  if (!inspectorProfile.full_name || inspectorProfile.role_pref !== "inspector") {
    check(
      await inspector.client.rpc("complete_profile", { p_full_name: FOUND_INSPECTOR_NAME, p_role_pref: "inspector" }),
      "complete_profile (inspector)",
    );
  }
  const inspectorMembership = check(
    await inspector.client.from("company_members").select("company_id").eq("user_id", inspector.userId).maybeSingle(),
    "read inspector membership",
  );
  if (inspectorMembership) {
    check(await owner.client.rpc("remove_company_member", { p_user_id: inspector.userId }), "remove_company_member");
  }
  if (!inspectorProfile.onboarded_at) {
    check(await inspector.client.rpc("finish_onboarding_without_company"), "finish_onboarding_without_company");
  }

  await revokePendingInvitations();
  return { ownerId: owner.userId, inspectorId: inspector.userId, companyId, projectId: project.id };
}

/** Revokes every pending invitation to found-inspector in the found tenant (owner's view). */
export async function revokePendingInvitations(): Promise<void> {
  const owner = await supabaseAs("foundOwner");
  const pending = check(
    await owner.client.from("invitations").select("id").eq("email", ACCOUNTS.foundInspector).eq("status", "pending"),
    "list invitations",
  );
  for (const invitation of pending ?? []) {
    check(await owner.client.rpc("revoke_invitation", { p_invitation_id: invitation.id }), "revoke_invitation");
  }
}

/** Removes found-inspector from the found company again (back to "No company yet"). */
export async function resetFoundInspector(): Promise<void> {
  const owner = await supabaseAs("foundOwner");
  const inspector = await supabaseAs("foundInspector");
  const membership = check(
    await inspector.client.from("company_members").select("company_id").eq("user_id", inspector.userId).maybeSingle(),
    "read inspector membership",
  );
  if (membership) check(await owner.client.rpc("remove_company_member", { p_user_id: inspector.userId }), "remove_company_member");
  await revokePendingInvitations();
}

/** A fresh one-use company-wide code from the found owner. Returns the code and its id. */
export async function createFoundInviteCode(): Promise<{ id: string; code: string }> {
  const owner = await supabaseAs("foundOwner");
  const row = must(await owner.client.rpc("create_invite_code", { p_expires_in_days: 1, p_max_uses: 1 }), "create_invite_code");
  return { id: row.id, code: row.code };
}

export async function revokeFoundInviteCode(id: string): Promise<void> {
  const owner = await supabaseAs("foundOwner");
  check(await owner.client.rpc("revoke_invite_code", { p_id: id }), "revoke_invite_code");
}

/** Invites found-inspector to the found project (email invitation). */
export async function inviteFoundInspector(projectId: string): Promise<void> {
  const owner = await supabaseAs("foundOwner");
  check(
    await owner.client.rpc("invite_to_project", { p_project_id: projectId, p_email: ACCOUNTS.foundInspector, p_role: "inspector" }),
    "invite_to_project",
  );
}
