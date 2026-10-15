/**
 * The e2e tenant for the profile, company-settings and notifications specs (e2e/f5-*.spec.ts),
 * kept apart from the demo company. The accounts come from supabase/seed/f5-e2e.sql; everything
 * else is created here through the app's own RPCs, so it is idempotent:
 *
 * - f5-owner: Owner PM of "[F5] Account QA Builders" with "[F5] Tagaytay Ridge Villas" and an
 *   over-budget "[F5] Batangas Port Annex" (so the owner has alerts), plus a pending invitation.
 * - f5-pm: company PM, joined "[F5] Tagaytay Ridge Villas" by email invitation.
 * - f5-inspector: inspector who joined with a company-wide invite code.
 * - f5-member: inspector the specs promote, demote and remove; `ensureF5Member()` re-adds them.
 * - f5-profile: Owner PM of "[F5] Profile Sandbox Co"; the profile specs edit this account.
 */
import { supabaseAs, type Who } from "./helpers/auth";

export const F5 = {
  owner: { email: "f5-owner@civpms.test" },
  pm: { email: "f5-pm@civpms.test" },
  inspector: { email: "f5-inspector@civpms.test" },
  member: { email: "f5-member@civpms.test" },
  profile: { email: "f5-profile@civpms.test" },
} as const satisfies Record<string, Who>;

export const F5_COMPANY = "[F5] Account QA Builders";
export const F5_PROFILE_COMPANY = "[F5] Profile Sandbox Co";
export const F5_PROJECT = "[F5] Tagaytay Ridge Villas";
export const F5_ALERT_PROJECT = "[F5] Batangas Port Annex";
export const F5_PENDING_EMAIL = "f5-pending@civpms.test";
export const F5_NAMES = {
  owner: "[F5] Olivia Ocampo",
  pm: "[F5] Paolo Mendoza",
  inspector: "[F5] Ines Villanueva",
  member: "[F5] Marco Santos",
  profile: "[F5] Pia Navarro",
} as const;

type Result<T> = { data: T; error: { message: string; code?: string; details?: string } | null };

export function check<T>(result: Result<T>, what: string): T {
  if (result.error) throw new Error(`${what} failed: ${result.error.code ?? ""} ${result.error.message} ${result.error.details ?? ""}`);
  return result.data;
}

function must<T>(result: Result<T>, what: string): NonNullable<T> {
  const data = check(result, what);
  if (data === null || data === undefined) throw new Error(`${what} returned nothing`);
  return data;
}

/** Unique suffix for record names, e.g. "1015-031140-517". */
export function stamp(): string {
  const d = new Date();
  const p = (n: number, w = 2) => String(n).padStart(w, "0");
  return `${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}-${p(d.getMilliseconds(), 3)}`;
}

async function ensureProfile(who: Who, name: string, role: "pm" | "inspector"): Promise<string> {
  const { client, userId } = await supabaseAs(who);
  const profile = must(await client.from("profiles").select("full_name, role_pref").eq("id", userId).single(), "read profile");
  if (profile.full_name !== name || profile.role_pref !== role) {
    check(await client.rpc("complete_profile", { p_full_name: name, p_role_pref: role }), "complete_profile");
  }
  return userId;
}

async function ensureOwnCompany(who: Who, name: string): Promise<string> {
  const { client, userId } = await supabaseAs(who);
  const membership = check(await client.from("company_members").select("company_id").eq("user_id", userId).maybeSingle(), "read membership");
  if (membership) return membership.company_id;
  return must(await client.rpc("create_company", { p_name: name }), `create_company ${name}`).id;
}

async function ensureProject(name: string, options: { budget: number; color: "teal" | "purple"; site: string }): Promise<{ id: string; created: boolean }> {
  const owner = await supabaseAs(F5.owner);
  const found = check(
    await owner.client.from("projects").select("id").eq("name", name).is("deleted_at", null).maybeSingle(),
    `read ${name}`,
  );
  if (found) return { id: found.id, created: false };
  const created = must(
    await owner.client.rpc("create_project", {
      p_name: name,
      p_start_date: "2026-11-02",
      p_end_date: "2027-08-31",
      p_budget: options.budget,
      p_site_name: options.site,
      p_color: options.color,
    }),
    `create_project ${name}`,
  );
  return { id: created.id, created: true };
}

/** Makes `who` join the owner's company as an inspector with a fresh single-use company code. */
async function joinWithCompanyCode(who: Who): Promise<string> {
  const owner = await supabaseAs(F5.owner);
  const member = await supabaseAs(who);
  const existing = check(
    await member.client.from("company_members").select("company_id").eq("user_id", member.userId).maybeSingle(),
    "read member company",
  );
  if (existing) return member.userId;
  const code = must(await owner.client.rpc("create_invite_code", { p_expires_in_days: 1, p_max_uses: 1 }), "create_invite_code");
  const redeemed = must(await member.client.rpc("redeem_invite_code", { p_code: code.code }), "redeem_invite_code") as {
    ok?: boolean;
    error_code?: string;
  };
  if (!redeemed.ok) throw new Error(`redeem_invite_code failed: ${redeemed.error_code}`);
  // The single-use code is "Used up" now; nothing usable is left behind.
  return member.userId;
}

export type F5Tenant = {
  companyId: string;
  projectId: string;
  alertProjectId: string;
  ownerId: string;
  pmId: string;
  inspectorId: string;
  memberId: string;
};

/** f5-member back in the company as an inspector (specs remove and re-add them). */
export async function ensureF5Member(): Promise<string> {
  await ensureProfile(F5.member, F5_NAMES.member, "inspector");
  const memberId = await joinWithCompanyCode(F5.member);
  const owner = await supabaseAs(F5.owner);
  const row = must(await owner.client.from("company_members").select("role").eq("user_id", memberId).single(), "read member role");
  if (row.role !== "inspector") {
    check(await owner.client.rpc("set_company_member_role", { p_user_id: memberId, p_role: "inspector" }), "reset member role");
  }
  return memberId;
}

export async function ensureF5Tenant(): Promise<F5Tenant> {
  const ownerId = await ensureProfile(F5.owner, F5_NAMES.owner, "pm");
  await ensureProfile(F5.pm, F5_NAMES.pm, "pm");
  await ensureProfile(F5.inspector, F5_NAMES.inspector, "inspector");
  const companyId = await ensureOwnCompany(F5.owner, F5_COMPANY);
  const owner = await supabaseAs(F5.owner);

  const project = await ensureProject(F5_PROJECT, { budget: 48_500_000, color: "teal", site: "[F5] Brgy. Silang Crossing" });
  const alert = await ensureProject(F5_ALERT_PROJECT, { budget: 1_000_000, color: "purple", site: "[F5] Batangas Port, Pier 3" });
  if (alert.created) {
    const deliverable = must(
      await owner.client.rpc("create_activity", { p_project_id: alert.id, p_parent_id: null as unknown as string, p_name: "[F5] Pier works" }),
      "create_activity (deliverable)",
    );
    check(
      await owner.client.rpc("create_activity", {
        p_project_id: alert.id,
        p_parent_id: deliverable.id,
        p_name: "[F5] Fender replacement",
        p_fields: { est_cost: 1_350_000 },
      }),
      "create_activity (over budget)",
    );
  }

  // The PM joins the main project by email invitation (and so the company, as PM).
  const pm = await supabaseAs(F5.pm);
  const pmMember = check(
    await owner.client.from("project_members").select("id").eq("project_id", project.id).eq("user_id", pm.userId).maybeSingle(),
    "read pm membership",
  );
  if (!pmMember) {
    const invite = must(
      await owner.client.rpc("invite_to_project", { p_project_id: project.id, p_email: F5.pm.email, p_role: "pm" }),
      "invite pm",
    ) as { invitation_id: string };
    check(await pm.client.rpc("accept_invitation", { p_invitation_id: invite.invitation_id }), "accept pm invitation");
  }

  const inspectorId = await joinWithCompanyCode(F5.inspector);
  const memberId = await ensureF5Member();

  // One pending invitation for the company-wide overview.
  const pending = check(
    await owner.client
      .from("invitations")
      .select("id")
      .eq("email", F5_PENDING_EMAIL)
      .eq("status", "pending")
      .gt("expires_at", new Date(Date.now() + 24 * 3600 * 1000).toISOString())
      .maybeSingle(),
    "read pending invitation",
  );
  if (!pending) {
    check(
      await owner.client.rpc("invite_to_project", { p_project_id: project.id, p_email: F5_PENDING_EMAIL, p_role: "inspector" }),
      "invite pending",
    );
  }

  // One active company-wide code (the screenshots show it; specs create their own).
  const activeCodes = check(
    await owner.client
      .from("invite_codes")
      .select("id, expires_at, max_uses, use_count, revoked_at")
      .is("project_id", null)
      .is("revoked_at", null)
      .gt("expires_at", new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString())
      .eq("max_uses", 25),
    "read showcase code",
  );
  if (!activeCodes || activeCodes.length === 0) {
    check(await owner.client.rpc("create_invite_code", { p_expires_in_days: 90, p_max_uses: 25 }), "create showcase code");
  }

  // The profile sandbox: a separate one-person company.
  await ensureProfile(F5.profile, F5_NAMES.profile, "pm");
  await ensureOwnCompany(F5.profile, F5_PROFILE_COMPANY);

  return { companyId, projectId: project.id, alertProjectId: alert.id, ownerId, pmId: pm.userId, inspectorId, memberId };
}
