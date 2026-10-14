/**
 * The e2e tenant for the projects-home specs (e2e/f2-*.spec.ts), kept apart from the demo company
 * so creating, archiving and deleting projects never changes demo data. The three accounts come from
 * supabase/seed/f2-e2e.sql; everything else is created here through the app's own RPCs:
 *
 * - f2-owner: Owner PM of "[F2] Home QA Builders" with a few showcase projects (Active, On-Hold,
 *   a Delayed Planning project and a Cancelled + Archived one).
 * - f2-empty: Owner PM of "[F2] Fresh Start Co", which never has a project (first-run state).
 * - f2-inspector: inspector of "[F2] Home QA Builders" (joined with a company code), on no project.
 */
import { supabaseAs } from "./helpers/auth";

export const F2_OWNER = { email: "f2-owner@civpms.test" } as const;
export const F2_EMPTY = { email: "f2-empty@civpms.test" } as const;
export const F2_INSPECTOR = { email: "f2-inspector@civpms.test" } as const;

export const F2_COMPANY = "[F2] Home QA Builders";
export const F2_EMPTY_COMPANY = "[F2] Fresh Start Co";

export const F2_PROJECTS = {
  active: "[F2] Bohol Bridge Retrofit",
  onHold: "[F2] Quezon Flood Control",
  delayed: "[F2] Iloilo Seawall Repair",
  archived: "[F2] Pasig Ferry Terminal",
} as const;

type Result<T> = { data: T; error: { message: string; code?: string; details?: string } | null };

function check<T>(result: Result<T>, what: string): T {
  if (result.error) throw new Error(`${what} failed: ${result.error.code ?? ""} ${result.error.message} ${result.error.details ?? ""}`);
  return result.data;
}

function must<T>(result: Result<T>, what: string): NonNullable<T> {
  const data = check(result, what);
  if (data === null || data === undefined) throw new Error(`${what} returned nothing`);
  return data;
}

type Client = Awaited<ReturnType<typeof supabaseAs>>["client"];

async function ensureProfile(client: Client, userId: string, fullName: string, role: "pm" | "inspector") {
  const profile = must(
    await client.from("profiles").select("full_name, role_pref").eq("id", userId).single(),
    `read profile of ${fullName}`,
  );
  if (profile.full_name !== fullName || profile.role_pref !== role) {
    check(await client.rpc("complete_profile", { p_full_name: fullName, p_role_pref: role }), `complete_profile ${fullName}`);
  }
}

async function ensureCompany(client: Client, userId: string, name: string): Promise<string> {
  const membership = check(
    await client.from("company_members").select("company_id").eq("user_id", userId).maybeSingle(),
    "read membership",
  );
  if (membership) return membership.company_id;
  const company = must(await client.rpc("create_company", { p_name: name }), `create_company ${name}`);
  return company.id;
}

async function findProject(client: Client, name: string) {
  return check(
    await client.from("projects").select("id, status, is_archived").eq("name", name).maybeSingle(),
    `read ${name}`,
  );
}

export type F2Tenant = { companyId: string; projectIds: Record<keyof typeof F2_PROJECTS, string> };

/** Creates whatever is missing and puts the showcase projects back in their expected state. */
export async function ensureF2Tenant(): Promise<F2Tenant> {
  const owner = await supabaseAs(F2_OWNER);
  await ensureProfile(owner.client, owner.userId, "[F2] Olivia Home", "pm");
  const companyId = await ensureCompany(owner.client, owner.userId, F2_COMPANY);

  const specs: Record<keyof typeof F2_PROJECTS, { start: string; end: string; budget: number; site: string; color: "blue" | "green" | "pink" | "graphite" }> = {
    active: { start: "2026-10-19", end: "2027-06-30", budget: 86_500_000, site: "[F2] Tagbilaran–Panglao link", color: "blue" },
    onHold: { start: "2026-11-02", end: "2027-09-30", budget: 128_000_000, site: "[F2] Marikina River, Brgy. Tumana", color: "green" },
    delayed: { start: "2026-05-04", end: "2026-09-15", budget: 12_750_000, site: "[F2] Iloilo City Esplanade", color: "pink" },
    archived: { start: "2026-01-12", end: "2026-12-18", budget: 54_000_000, site: "[F2] Pinagbuhatan terminal", color: "graphite" },
  };

  const projectIds = {} as Record<keyof typeof F2_PROJECTS, string>;
  for (const key of Object.keys(F2_PROJECTS) as Array<keyof typeof F2_PROJECTS>) {
    const name = F2_PROJECTS[key];
    const spec = specs[key];
    let project = await findProject(owner.client, name);
    if (!project) {
      const created = must(
        await owner.client.rpc("create_project", {
          p_name: name,
          p_start_date: spec.start,
          p_end_date: spec.end,
          p_budget: spec.budget,
          p_site_name: spec.site,
          p_color: spec.color,
        }),
        `create_project ${name}`,
      );
      project = { id: created.id, status: created.status, is_archived: created.is_archived };
    }
    projectIds[key] = project.id;

    if (key === "active" && project.status === "planning") {
      check(await owner.client.rpc("set_project_status", { p_project_id: project.id, p_status: "active" }), "activate");
    }
    if (key === "onHold") {
      if (project.status === "planning") {
        check(await owner.client.rpc("set_project_status", { p_project_id: project.id, p_status: "active" }), "activate");
        project.status = "active";
      }
      if (project.status === "active") {
        check(
          await owner.client.rpc("set_project_status", {
            p_project_id: project.id,
            p_status: "on_hold",
            p_reason: "[F2] Waiting for DPWH right-of-way clearance",
          }),
          "put on hold",
        );
      }
    }
    if (key === "archived") {
      if (project.status !== "cancelled") {
        check(
          await owner.client.rpc("set_project_status", {
            p_project_id: project.id,
            p_status: "cancelled",
            p_reason: "[F2] Client withdrew the contract",
          }),
          "cancel",
        );
      }
      if (!project.is_archived) {
        check(await owner.client.rpc("set_project_archived", { p_project_id: project.id, p_archived: true }), "archive");
      }
    }
  }

  // Empty company: an Owner PM with no live project.
  const empty = await supabaseAs(F2_EMPTY);
  await ensureProfile(empty.client, empty.userId, "[F2] Erin Empty", "pm");
  await ensureCompany(empty.client, empty.userId, F2_EMPTY_COMPANY);
  const stray = check(await empty.client.from("projects").select("id"), "read empty company projects") ?? [];
  for (const row of stray) {
    check(await empty.client.rpc("delete_project", { p_project_id: row.id }), "delete stray project");
  }

  // Inspector in the company, on no project.
  const inspector = await supabaseAs(F2_INSPECTOR);
  await ensureProfile(inspector.client, inspector.userId, "[F2] Ivan Inspector", "inspector");
  const inspectorMembership = check(
    await inspector.client.from("company_members").select("company_id").eq("user_id", inspector.userId).maybeSingle(),
    "read inspector membership",
  );
  if (!inspectorMembership) {
    const code = must(await owner.client.rpc("create_invite_code", { p_expires_in_days: 1, p_max_uses: 1 }), "create_invite_code");
    const redeemed = must(await inspector.client.rpc("redeem_invite_code", { p_code: code.code }), "redeem_invite_code") as {
      ok?: boolean;
      error_code?: string;
    };
    if (!redeemed.ok) throw new Error(`redeem_invite_code failed: ${redeemed.error_code ?? "unknown"}`);
    check(await owner.client.rpc("revoke_invite_code", { p_id: code.id }), "revoke_invite_code");
  }
  const memberships =
    check(await owner.client.from("project_members").select("project_id").eq("user_id", inspector.userId), "read inspector projects") ?? [];
  for (const row of memberships) {
    check(
      await owner.client.rpc("remove_project_member", { p_project_id: row.project_id, p_user_id: inspector.userId }),
      "remove_project_member",
    );
  }

  return { companyId, projectIds };
}

/** Soft-deletes a project the specs created (it stays restorable for 30 days, then is purged). */
export async function deleteF2Project(projectId: string): Promise<void> {
  const owner = await supabaseAs(F2_OWNER);
  const result = await owner.client.rpc("delete_project", { p_project_id: projectId });
  if (result.error && result.error.message !== "NOT_FOUND") check(result, "delete_project");
}

/** A project name that is unique per run. */
export function uniqueF2Name(label: string): string {
  const stamp = new Date().toISOString().replace(/\D/g, "").slice(4, 14);
  return `[F2] ${label} ${stamp}${Math.floor(Math.random() * 90 + 10)}`;
}
