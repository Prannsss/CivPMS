/**
 * The e2e tenant for the project-workspace specs (e2e/f3-*.spec.ts), kept apart from the demo
 * company so tests never change demo data: "[F3] Workspace QA" with
 *   - f3-owner@civpms.test      Owner PM
 *   - f3-pm@civpms.test         company PM, member of the base project (joined by email invitation)
 *   - f3-inspector@civpms.test  inspector on the base project (joined by email invitation)
 * The accounts come from supabase/seed/f3-e2e.sql; everything else is created here through the
 * app's own RPCs, so it is idempotent. Specs create their own timestamped "[F3] …" projects.
 */
import { supabaseAs, type Who } from "./auth";

export const F3 = {
  owner: { email: "f3-owner@civpms.test" },
  pm: { email: "f3-pm@civpms.test" },
  inspector: { email: "f3-inspector@civpms.test" },
} as const satisfies Record<string, Who>;

export const F3_COMPANY = "[F3] Workspace QA";
export const F3_BASE_PROJECT = "[F3] Base Project";
export const F3_NAMES = { owner: "[F3] Olga Owner", pm: "[F3] Pia Manager", inspector: "[F3] Ivan Inspector" } as const;

export type F3Tenant = {
  ownerId: string;
  pmId: string;
  inspectorId: string;
  companyId: string;
  baseProjectId: string;
};

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

/** Unique suffix for record names, e.g. "1013-142233-517". */
export function stamp(): string {
  const d = new Date();
  const p = (n: number, w = 2) => String(n).padStart(w, "0");
  return `${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}-${p(d.getMilliseconds(), 3)}`;
}

async function ensureProfile(who: Who, name: string, role: "pm" | "inspector"): Promise<void> {
  const { client, userId } = await supabaseAs(who);
  const profile = must(await client.from("profiles").select("full_name, role_pref").eq("id", userId).single(), "read profile");
  if (profile.full_name !== name || profile.role_pref !== role) {
    check(await client.rpc("complete_profile", { p_full_name: name, p_role_pref: role }), "complete_profile");
  }
}

/** Makes `who` a member of the project with `role`, through an invitation they accept. */
async function ensureMember(projectId: string, who: { email: string }, role: "pm" | "inspector"): Promise<string> {
  const owner = await supabaseAs(F3.owner);
  const member = await supabaseAs(who);
  const existing = check(
    await owner.client.from("project_members").select("id").eq("project_id", projectId).eq("user_id", member.userId).maybeSingle(),
    "read project member",
  );
  if (!existing) {
    const invite = must(
      await owner.client.rpc("invite_to_project", { p_project_id: projectId, p_email: who.email, p_role: role }),
      "invite_to_project",
    ) as { invitation_id: string };
    check(await member.client.rpc("accept_invitation", { p_invitation_id: invite.invitation_id }), "accept_invitation");
  }
  return member.userId;
}

export async function ensureF3Tenant(): Promise<F3Tenant> {
  const owner = await supabaseAs(F3.owner);
  await ensureProfile(F3.owner, F3_NAMES.owner, "pm");
  await ensureProfile(F3.pm, F3_NAMES.pm, "pm");
  await ensureProfile(F3.inspector, F3_NAMES.inspector, "inspector");

  let membership = check(
    await owner.client.from("company_members").select("company_id").eq("user_id", owner.userId).maybeSingle(),
    "read owner membership",
  );
  if (!membership) {
    const company = must(await owner.client.rpc("create_company", { p_name: F3_COMPANY }), "create_company");
    membership = { company_id: company.id };
  }

  let base = check(
    await owner.client
      .from("projects")
      .select("id")
      .eq("company_id", membership.company_id)
      .eq("name", F3_BASE_PROJECT)
      .is("deleted_at", null)
      .maybeSingle(),
    "read base project",
  );
  if (!base) {
    const created = must(
      await owner.client.rpc("create_project", {
        p_name: F3_BASE_PROJECT,
        p_start_date: "2026-11-02",
        p_end_date: "2027-06-30",
        p_budget: 12_500_000,
        p_site_name: "[F3] Mandaue reclamation area",
        p_color: "teal",
      }),
      "create_project (base)",
    );
    base = { id: created.id };
  }

  const pmId = await ensureMember(base.id, F3.pm, "pm");
  const inspectorId = await ensureMember(base.id, F3.inspector, "inspector");
  return { ownerId: owner.userId, pmId, inspectorId, companyId: membership.company_id, baseProjectId: base.id };
}

/** Last day of `days` Mon–Fri working days starting on `start` (no holidays; fine for test data). */
export function endAfterWorkingDays(start: string, days: number): string {
  const date = new Date(`${start}T00:00:00Z`);
  let counted = 0;
  for (;;) {
    const weekday = date.getUTCDay();
    if (weekday !== 0 && weekday !== 6) counted += 1;
    if (counted === days) return date.toISOString().slice(0, 10);
    date.setUTCDate(date.getUTCDate() + 1);
  }
}

export type F3ProjectOptions = {
  name: string;
  startDate?: string;
  endDate?: string;
  budget?: number;
  siteName?: string;
  color?: "blue" | "green" | "pink" | "purple" | "teal" | "graphite";
  /**
   * Work packages under one deliverable: [name, cost, start]. A null cost or start leaves that
   * value out (an unscheduled work package); start defaults to 9 Nov 2026 (40 h).
   */
  workPackages?: [string, number | null, (string | null)?][];
  /** Add the F3 PM / inspector to the project. */
  members?: ("pm" | "inspector")[];
};

/** Creates a fresh project as the F3 owner. Returns its id. */
export async function createF3Project(options: F3ProjectOptions): Promise<string> {
  const owner = await supabaseAs(F3.owner);
  const project = must(
    await owner.client.rpc("create_project", {
      p_name: options.name,
      p_start_date: options.startDate ?? "2026-11-02",
      p_end_date: options.endDate ?? "2027-03-31",
      p_budget: options.budget ?? 5_000_000,
      p_site_name: options.siteName ?? "[F3] Test site",
      p_color: options.color ?? "purple",
    }),
    "create_project",
  );
  if (options.workPackages?.length) {
    const deliverable = must(
      await owner.client.rpc("create_activity", { p_project_id: project.id, p_parent_id: null as unknown as string, p_name: "[F3] Site works" }),
      "create_activity (deliverable)",
    );
    for (const [name, cost, start] of options.workPackages) {
      const fields: Record<string, string | number> = {};
      if (start !== null) {
        const from = start ?? "2026-11-09";
        Object.assign(fields, { start_date: from, duration_hours: 40, end_date: endAfterWorkingDays(from, 5) });
      }
      if (cost !== null) fields.est_cost = cost;
      check(
        await owner.client.rpc("create_activity", {
          p_project_id: project.id,
          p_parent_id: deliverable.id,
          p_name: name,
          p_fields: fields,
        }),
        "create_activity (work package)",
      );
    }
  }
  for (const member of options.members ?? []) {
    await ensureMember(project.id, F3[member], member);
  }
  return project.id;
}

/** Moves an F3 project to the trash (ignores projects that are already gone). */
export async function deleteF3Project(projectId: string): Promise<void> {
  const owner = await supabaseAs(F3.owner);
  const { error } = await owner.client.rpc("delete_project", { p_project_id: projectId });
  if (error && error.message !== "NOT_FOUND") throw new Error(`delete_project failed: ${error.message}`);
}
