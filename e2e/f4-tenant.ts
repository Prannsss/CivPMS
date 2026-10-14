/**
 * The e2e tenant for the WBS + calendar specs (e2e/f4-*.spec.ts), kept apart from the demo company
 * so specs never change demo data. Accounts come from supabase/seed/f4-e2e.sql; everything else is
 * created here through the app's own RPCs:
 *
 * - f4-owner: Owner PM of "[F4] WBS Lab Builders".
 * - "[F4] Metro Drainage Upgrade": a showcase project with a three-level WBS (screenshots, read
 *   checks). f4-pm is a project PM on it and f4-inspector an inspector (joined by invitation).
 * - "[F4] Cancelled Seawall": a cancelled project (locked WBS and calendar).
 * - Specs that change data create their own uniquely named project and delete it afterwards.
 */
import { supabaseAs } from "./helpers/auth";

export const F4_OWNER = { email: "f4-owner@civpms.test" } as const;
export const F4_PM = { email: "f4-pm@civpms.test" } as const;
export const F4_INSPECTOR = { email: "f4-inspector@civpms.test" } as const;

export const F4_COMPANY = "[F4] WBS Lab Builders";
export const F4_SHOWCASE = "[F4] Metro Drainage Upgrade";
export const F4_CANCELLED = "[F4] Cancelled Seawall";
export const F4_EMPTY = "[F4] Riverside Footbridge";

type Result<T> = { data: T; error: { message: string; code?: string; details?: string } | null };
type Client = Awaited<ReturnType<typeof supabaseAs>>["client"];

function check<T>(result: Result<T>, what: string): T {
  if (result.error) throw new Error(`${what} failed: ${result.error.code ?? ""} ${result.error.message} ${result.error.details ?? ""}`);
  return result.data;
}

function must<T>(result: Result<T>, what: string): NonNullable<T> {
  const data = check(result, what);
  if (data === null || data === undefined) throw new Error(`${what} returned nothing`);
  return data;
}

async function ensureProfile(client: Client, userId: string, fullName: string, role: "pm" | "inspector") {
  const profile = must(await client.from("profiles").select("full_name, role_pref").eq("id", userId).single(), `profile ${fullName}`);
  if (profile.full_name !== fullName || profile.role_pref !== role) {
    check(await client.rpc("complete_profile", { p_full_name: fullName, p_role_pref: role }), `complete_profile ${fullName}`);
  }
}

async function ensureCompany(client: Client, userId: string, name: string): Promise<string> {
  const membership = check(await client.from("company_members").select("company_id").eq("user_id", userId).maybeSingle(), "membership");
  if (membership) return membership.company_id;
  return must(await client.rpc("create_company", { p_name: name }), `create_company ${name}`).id;
}

async function ensureProject(
  client: Client,
  name: string,
  spec: { start: string; end: string; budget: number; site: string; color: "blue" | "teal" | "purple" | "green" },
): Promise<{ id: string; status: string }> {
  const existing = check(await client.from("projects").select("id, status").eq("name", name).maybeSingle(), `read ${name}`);
  if (existing) return existing;
  const created = must(
    await client.rpc("create_project", {
      p_name: name,
      p_start_date: spec.start,
      p_end_date: spec.end,
      p_budget: spec.budget,
      p_site_name: spec.site,
      p_color: spec.color,
    }),
    `create_project ${name}`,
  );
  return { id: created.id, status: created.status };
}

async function ensureMember(
  owner: Client,
  projectId: string,
  member: Awaited<ReturnType<typeof supabaseAs>>,
  role: "pm" | "inspector",
) {
  const row = check(
    await owner.from("project_members").select("role").eq("project_id", projectId).eq("user_id", member.userId).maybeSingle(),
    "read member",
  );
  if (row) return;
  const invited = must(
    await owner.rpc("invite_to_project", { p_project_id: projectId, p_email: member.email, p_role: role }),
    `invite ${member.email}`,
  ) as { invitation_id: string };
  check(await member.client.rpc("accept_invitation", { p_invitation_id: invited.invitation_id }), `accept ${member.email}`);
}

/**
 * Minimal working-calendar math for seeding (D20: end = the working day on which the last working
 * hour falls). Playwright's transpiler can't load src/lib/domain, so this mirrors computeEndDate.
 */
export type SeedCalendar = { hoursPerDay: number; isWorking: (date: string) => boolean };

function shiftDay(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function nextWorkingDay(cal: SeedCalendar, date: string, inclusive: boolean): string {
  let cursor = inclusive ? date : shiftDay(date, 1);
  while (!cal.isWorking(cursor)) cursor = shiftDay(cursor, 1);
  return cursor;
}

function computeEndDate(cal: SeedCalendar, start: string, hours: number): string {
  if (hours === 0) return start;
  let remaining = Math.ceil(hours / cal.hoursPerDay);
  let cursor = nextWorkingDay(cal, start, true);
  while (--remaining > 0) cursor = nextWorkingDay(cal, cursor, false);
  return cursor;
}

/** The project's stored working calendar. */
export async function projectCalendar(client: Client, projectId: string): Promise<SeedCalendar> {
  const settings = must(
    await client.from("calendars").select("work_days, hours_per_day, holidays_nonworking").eq("project_id", projectId).single(),
    "read calendar",
  );
  const dates = check(await client.from("calendar_dates").select("date, kind").eq("project_id", projectId), "read calendar dates") ?? [];
  const kinds = new Map<string, Set<string>>();
  for (const d of dates) kinds.set(d.date, (kinds.get(d.date) ?? new Set()).add(d.kind));
  return {
    hoursPerDay: Number(settings.hours_per_day),
    isWorking: (date) => {
      const k = kinds.get(date);
      if (k?.has("override_working")) return true;
      if (k?.has("override_nonworking")) return false;
      if (k?.has("holiday") && settings.holidays_nonworking) return false;
      const weekday = ((new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7) + 1;
      return settings.work_days.includes(weekday);
    },
  };
}

type Pkg = { name: string; days: number; cost: number };
type Sub = { name: string; packages: Pkg[] };
type Deliverable = { name: string; children: Array<Pkg | Sub> };

const SHOWCASE_WBS: Deliverable[] = [
  {
    name: "Site preparation and mobilization",
    children: [
      { name: "Mobilization and temporary facilities", days: 5, cost: 850_000 },
      { name: "Survey, staking and utility mapping", days: 4, cost: 320_000 },
      { name: "Clearing and grubbing", days: 6, cost: 540_000 },
    ],
  },
  {
    name: "Drainage works",
    children: [
      {
        name: "Main box culvert",
        packages: [
          { name: "Structure excavation", days: 12, cost: 2_400_000 },
          { name: "Reinforced concrete box culvert", days: 30, cost: 14_800_000 },
          { name: "Backfill and compaction", days: 8, cost: 1_250_000 },
        ],
      },
      {
        name: "Lateral pipes and inlets",
        packages: [
          { name: "RCPC 910 mm pipe laying", days: 20, cost: 6_900_000 },
          { name: "Catch basins and manholes", days: 15, cost: 3_450_000 },
        ],
      },
    ],
  },
  {
    name: "Road restoration and turnover",
    children: [
      { name: "PCCP restoration", days: 25, cost: 9_800_000 },
      { name: "Pavement markings and signage", days: 5, cost: 650_000 },
      { name: "Final inspection and turnover", days: 0, cost: 0 },
    ],
  },
];

/** Creates the showcase WBS through create_activity (sequential work packages). */
async function seedShowcaseWbs(client: Client, projectId: string, start: string) {
  const index = await projectCalendar(client, projectId);
  let cursor = nextWorkingDay(index, start, true);
  const createPackage = async (parentId: string, pkg: Pkg) => {
    const hours = pkg.days * index.hoursPerDay;
    const end = computeEndDate(index, cursor, hours);
    check(
      await client.rpc("create_activity", {
        p_project_id: projectId,
        p_parent_id: parentId,
        p_name: pkg.name,
        p_fields: { start_date: cursor, duration_hours: hours, end_date: end, est_cost: pkg.cost },
      }),
      `create ${pkg.name}`,
    );
    cursor = hours === 0 ? cursor : nextWorkingDay(index, end, false);
  };
  for (const deliverable of SHOWCASE_WBS) {
    const d = must(
      await client.rpc("create_activity", { p_project_id: projectId, p_parent_id: null as unknown as string, p_name: deliverable.name }),
      `create ${deliverable.name}`,
    );
    for (const child of deliverable.children) {
      if ("packages" in child) {
        const sub = must(
          await client.rpc("create_activity", { p_project_id: projectId, p_parent_id: d.id, p_name: child.name }),
          `create ${child.name}`,
        );
        for (const pkg of child.packages) await createPackage(sub.id, pkg);
      } else {
        await createPackage(d.id, child);
      }
    }
  }
}

export type F4Tenant = { companyId: string; showcaseId: string; cancelledId: string; emptyId: string };

export async function ensureF4Tenant(): Promise<F4Tenant> {
  const owner = await supabaseAs(F4_OWNER);
  const pm = await supabaseAs(F4_PM);
  const inspector = await supabaseAs(F4_INSPECTOR);
  await ensureProfile(owner.client, owner.userId, "[F4] Olivia Ocampo", "pm");
  await ensureProfile(pm.client, pm.userId, "[F4] Paolo Mercado", "pm");
  await ensureProfile(inspector.client, inspector.userId, "[F4] Ines Bautista", "inspector");
  const companyId = await ensureCompany(owner.client, owner.userId, F4_COMPANY);

  const showcase = await ensureProject(owner.client, F4_SHOWCASE, {
    start: "2026-10-08",
    end: "2027-03-31",
    budget: 45_000_000,
    site: "[F4] España Blvd., Sampaloc, Manila",
    color: "teal",
  });
  await ensureMember(owner.client, showcase.id, pm, "pm");
  await ensureMember(owner.client, showcase.id, inspector, "inspector");
  const { count } = await owner.client
    .from("activities")
    .select("id", { count: "exact", head: true })
    .eq("project_id", showcase.id)
    .is("deleted_at", null);
  if (!count) await seedShowcaseWbs(owner.client, showcase.id, "2026-10-08");
  if (showcase.status === "planning") {
    check(await owner.client.rpc("set_project_status", { p_project_id: showcase.id, p_status: "active" }), "activate showcase");
  }

  const cancelled = await ensureProject(owner.client, F4_CANCELLED, {
    start: "2026-08-03",
    end: "2027-02-26",
    budget: 18_000_000,
    site: "[F4] Roxas Blvd. seawall",
    color: "purple",
  });
  if (cancelled.status !== "cancelled") {
    check(
      await owner.client.rpc("set_project_status", {
        p_project_id: cancelled.id,
        p_status: "cancelled",
        p_reason: "[F4] Contract terminated by the client",
      }),
      "cancel project",
    );
  }

  // An empty project (first-run WBS). Specs never add activities to it.
  const empty = await ensureProject(owner.client, F4_EMPTY, {
    start: "2026-11-02",
    end: "2027-05-28",
    budget: 7_500_000,
    site: "[F4] Marikina riverbank",
    color: "green",
  });

  return { companyId, showcaseId: showcase.id, cancelledId: cancelled.id, emptyId: empty.id };
}

/** A project name that is unique per run. */
export function uniqueF4Name(label: string): string {
  const stamp = new Date().toISOString().replace(/\D/g, "").slice(4, 14);
  return `[F4] ${label} ${stamp}${Math.floor(Math.random() * 90 + 10)}`;
}

/** A fresh, empty project owned by f4-owner for a spec that changes data. */
export async function createF4Project(label: string, budget = 5_000_000): Promise<{ id: string; name: string }> {
  const owner = await supabaseAs(F4_OWNER);
  const name = uniqueF4Name(label);
  const created = must(
    await owner.client.rpc("create_project", {
      p_name: name,
      p_start_date: "2026-10-12",
      p_end_date: "2027-03-31",
      p_budget: budget,
      p_site_name: "[F4] Test site",
      p_color: "blue",
    }),
    "create_project",
  );
  return { id: created.id, name };
}

/** Soft-deletes a project a spec created (restorable for 30 days, then purged). */
export async function deleteF4Project(projectId: string): Promise<void> {
  const owner = await supabaseAs(F4_OWNER);
  const result = await owner.client.rpc("delete_project", { p_project_id: projectId });
  if (result.error && result.error.message !== "NOT_FOUND") check(result, "delete_project");
}

/** Activities of a project (owner's view), for assertions. */
export async function readActivities(projectId: string) {
  const owner = await supabaseAs(F4_OWNER);
  return (
    check(
      await owner.client
        .from("activities")
        .select("id, parent_id, name, wbs_code, level, start_date, duration_hours, end_date, est_cost, version, deleted_at")
        .eq("project_id", projectId)
        .order("wbs_code"),
      "read activities",
    ) ?? []
  );
}
