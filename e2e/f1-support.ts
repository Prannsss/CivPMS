/**
 * Shared setup for the auth/onboarding specs (e2e/f1-*.spec.ts).
 *
 * - `claimFreshAccount()` hands out a confirmed, not-yet-onboarded account from the pool created by
 *   supabase/seed/f1-e2e.sql (f1-pool-NN@civpms.test). Onboarding is one-way, so every run uses new
 *   accounts; used ones are remembered in test-results/.f1-pool.json so they are not signed in
 *   again. Parallel workers claim accounts with an atomic lock file.
 * - `ensureF1Tenant()` sets up "[F1] Invitations Co." (Owner PM f1-owner@civpms.test) with one
 *   project, through the app's RPCs, for invite codes and email invitations.
 */
import { mkdir, open, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { test } from "@playwright/test";
import { sessionFor, supabaseAs, type Who } from "./helpers/auth";

export const F1_OWNER = "f1-owner@civpms.test";
export const F1_COMPANY = "[F1] Invitations Co.";
export const F1_PROJECT = "[F1] Invitation Test Project";
/** Must match civpms.f1_pool_size used with supabase/seed/f1-e2e.sql. */
const POOL_SIZE = Number(process.env.F1_POOL_SIZE ?? 60);

const STATE_DIR = path.join(process.cwd(), "test-results");
const USED_FILE = path.join(STATE_DIR, ".f1-pool.json");
const CLAIM_DIR = path.join(STATE_DIR, ".f1-claims");
const CLAIM_TTL_MS = 30 * 60 * 1000;

/** A unique-ish suffix for names created by a test ("[F1] Co 1760351234567-3"). */
export function stamp(): string {
  return `${Date.now().toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`;
}

function poolEmail(index: number): string {
  return `f1-pool-${String(index).padStart(2, "0")}@civpms.test`;
}

async function readUsed(): Promise<Set<string>> {
  try {
    return new Set(JSON.parse(await readFile(USED_FILE, "utf8")) as string[]);
  } catch {
    return new Set();
  }
}

async function markUsed(email: string): Promise<void> {
  const used = await readUsed();
  used.add(email);
  await mkdir(STATE_DIR, { recursive: true });
  await writeFile(USED_FILE, JSON.stringify([...used].sort()));
}

/** Atomically claims `email` for this worker (stale claims expire after 30 minutes). */
async function claim(email: string): Promise<boolean> {
  await mkdir(CLAIM_DIR, { recursive: true });
  const file = path.join(CLAIM_DIR, email);
  try {
    const handle = await open(file, "wx");
    await handle.close();
    return true;
  } catch {
    try {
      const info = await stat(file);
      if (Date.now() - info.mtimeMs > CLAIM_TTL_MS) {
        await writeFile(file, "");
        return true;
      }
    } catch {
      // claim vanished; try the next account
    }
    return false;
  }
}

export type FreshAccount = { email: string; userId: string };

/**
 * The next pool account that is signed-up, confirmed and has not started onboarding (no saved
 * name + role: onboarding would otherwise resume at step 3). Skips the test (with instructions)
 * when the pool is used up. The used list is per container, so accounts that a run in another
 * container left half-onboarded are skipped here too.
 */
export async function claimFreshAccount(): Promise<FreshAccount> {
  const used = await readUsed();
  for (let index = 1; index <= POOL_SIZE; index++) {
    const email = poolEmail(index);
    if (used.has(email)) continue;
    if (!(await claim(email))) continue;
    let session: Awaited<ReturnType<typeof sessionFor>>;
    try {
      session = await sessionFor({ email });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (/invalid_credentials|Invalid login/i.test(message)) {
        // Not seeded yet, or its password was changed: skip it for good.
        await markUsed(email);
        continue;
      }
      throw error;
    }
    const { client } = await supabaseAs({ email });
    const { data } = await client.from("profiles").select("onboarded_at, role_pref").eq("id", session.userId).maybeSingle();
    await markUsed(email); // used from now on, whatever the test does with it
    if (data && !data.onboarded_at && !data.role_pref) return { email, userId: session.userId };
  }
  test.skip(
    true,
    "No fresh f1-pool accounts left. Re-run supabase/seed/f1-e2e.sql with a bigger civpms.f1_pool_size.",
  );
  throw new Error("unreachable");
}

type RpcResult<T> = { data: T; error: { message: string; code?: string; details?: string } | null };

function must<T>(result: RpcResult<T>, what: string): NonNullable<T> {
  if (result.error) throw new Error(`${what} failed: ${result.error.code ?? ""} ${result.error.message} ${result.error.details ?? ""}`);
  if (result.data === null || result.data === undefined) throw new Error(`${what} returned nothing`);
  return result.data;
}

export type F1Tenant = { companyId: string; projectId: string };

const OWNER: Who = { email: F1_OWNER };

/** "[F1] Invitations Co." with "[F1] Invitation Test Project", created on first use. */
export async function ensureF1Tenant(): Promise<F1Tenant> {
  const { client, userId } = await supabaseAs(OWNER);
  const profile = must(
    await client.from("profiles").select("full_name, role_pref").eq("id", userId).single(),
    "read f1 owner profile",
  );
  if (!profile.full_name || profile.role_pref !== "pm") {
    must(await client.rpc("complete_profile", { p_full_name: "[F1] Olga Owner", p_role_pref: "pm" }), "complete_profile");
  }
  const membership = await client.from("company_members").select("company_id").eq("user_id", userId).maybeSingle();
  if (membership.error) throw new Error(membership.error.message);
  const companyId =
    membership.data?.company_id ?? must(await client.rpc("create_company", { p_name: F1_COMPANY }), "create_company").id;

  const existing = await client
    .from("projects")
    .select("id")
    .eq("company_id", companyId)
    .eq("name", F1_PROJECT)
    .is("deleted_at", null)
    .maybeSingle();
  if (existing.error) throw new Error(existing.error.message);
  const projectId =
    existing.data?.id ??
    must(
      await client.rpc("create_project", {
        p_name: F1_PROJECT,
        p_start_date: "2026-11-02",
        p_end_date: "2027-04-30",
        p_budget: 2_500_000,
        p_site_name: "[F1] Test site",
        p_color: "teal",
      }),
      "create_project",
    ).id;
  return { companyId, projectId };
}

/** A one-use company-wide inspector code from the F1 owner. */
export async function createF1InviteCode(): Promise<{ id: string; code: string }> {
  const { client } = await supabaseAs(OWNER);
  const row = must(await client.rpc("create_invite_code", { p_expires_in_days: 1, p_max_uses: 1 }), "create_invite_code");
  return { id: row.id, code: row.code };
}

export async function revokeF1InviteCode(id: string): Promise<void> {
  const { client } = await supabaseAs(OWNER);
  await client.rpc("revoke_invite_code", { p_id: id });
}

/** Invites `email` to the F1 project and returns the plaintext token (as in the email link). */
export async function inviteToF1Project(email: string, role: "pm" | "inspector"): Promise<{ token: string; id: string }> {
  const { projectId } = await ensureF1Tenant();
  const { client } = await supabaseAs(OWNER);
  const data = must(
    await client.rpc("invite_to_project", { p_project_id: projectId, p_email: email, p_role: role }),
    "invite_to_project",
  ) as { token?: string; invitation_id?: string };
  if (!data.token || !data.invitation_id) throw new Error("invite_to_project returned no token");
  return { token: data.token, id: data.invitation_id };
}

export async function revokeF1Invitation(id: string): Promise<void> {
  const { client } = await supabaseAs(OWNER);
  await client.rpc("revoke_invitation", { p_invitation_id: id });
}
