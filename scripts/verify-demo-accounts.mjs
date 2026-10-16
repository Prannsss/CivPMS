#!/usr/bin/env node
/**
 * Signs in as each demo account (supabase/seed/demo.sql) with the PUBLISHABLE key and checks what
 * RLS lets it see. Proves real email/password sign-in works and that tenants are isolated.
 *
 *   node --env-file=.env.local scripts/verify-demo-accounts.mjs
 *
 * Needs NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY and DEMO_PASSWORD.
 * Behind an HTTP proxy (agent containers) also set NODE_USE_ENV_PROXY=1.
 * Exits 1 when any expectation fails. Never prints the password.
 */
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const password = process.env.DEMO_PASSWORD;
if (!url || !key || !password) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY or DEMO_PASSWORD.");
  console.error("Run: node --env-file=.env.local scripts/verify-demo-accounts.mjs");
  process.exit(2);
}

const CEBU = "Cebu Coastal Road Widening";
const ILOILO = "Iloilo Riverside Mixed-Use Tower";
const DAVAO = "Davao Drainage Rehabilitation, Phase 2";
const LAGUNA = "Laguna Warehouse Expansion";
const PAMPANGA = "Pampanga Farm-to-Market Road, Package 1";

const EXPECTED = [
  { email: "owner@civpms.test", company: "Dela Cruz Builders", role: "owner_pm", onboarded: true, projects: [CEBU, ILOILO, DAVAO, LAGUNA] },
  { email: "pm@civpms.test", company: "Dela Cruz Builders", role: "pm", onboarded: true, projects: [CEBU, DAVAO] },
  { email: "inspector@civpms.test", company: "Dela Cruz Builders", role: "inspector", onboarded: true, projects: [CEBU] },
  { email: "rival@civpms.test", company: "Bayanihan Construction", role: "owner_pm", onboarded: true, projects: [PAMPANGA] },
  { email: "newbie@civpms.test", company: null, role: null, onboarded: false, projects: [] },
];

// Derived badges as the Owner PM sees them (project_overview).
const BADGES = {
  [CEBU]: { status: "active", budget_state: "ok", is_delayed: false, leaf_count: 16 },
  [ILOILO]: { status: "planning", budget_state: "near", is_delayed: false, leaf_count: 9 },
  [DAVAO]: { status: "active", budget_state: "exceeded", is_delayed: true, leaf_count: 9 },
  [LAGUNA]: { status: "planning", budget_state: "ok", is_delayed: false, leaf_count: 0 },
  [PAMPANGA]: { status: "planning", budget_state: "ok", is_delayed: false, leaf_count: 4 },
};

let failures = 0;
function check(condition, message) {
  if (condition) {
    console.log(`  ok    ${message}`);
  } else {
    failures += 1;
    console.log(`  FAIL  ${message}`);
  }
}

function newClient() {
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

for (const account of EXPECTED) {
  console.log(`\n${account.email}`);
  const supabase = newClient();
  const { data: auth, error: signInError } = await supabase.auth.signInWithPassword({ email: account.email, password });
  check(!signInError && Boolean(auth.session), `signs in with DEMO_PASSWORD${signInError ? ` (${signInError.message})` : ""}`);
  if (signInError) continue;

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("full_name, onboarded_at")
    .eq("id", auth.user.id)
    .single();
  check(!profileError && Boolean(profile?.onboarded_at) === account.onboarded,
    `onboarded = ${account.onboarded}${profile?.full_name ? ` (${profile.full_name})` : ""}`);

  const { data: membership } = await supabase
    .from("company_members")
    .select("role, companies(name)")
    .eq("user_id", auth.user.id)
    .maybeSingle();
  check((membership?.companies?.name ?? null) === account.company && (membership?.role ?? null) === account.role,
    `company = ${account.company ?? "none"} as ${account.role ?? "—"}`);

  const { data: projects, error: projectsError } = await supabase
    .from("project_overview")
    .select("name, status, budget_state, is_delayed, leaf_count, my_project_role, my_company_role")
    .order("name");
  const names = (projects ?? []).map((p) => p.name).sort();
  check(!projectsError && JSON.stringify(names) === JSON.stringify([...account.projects].sort()),
    `sees ${names.length} project(s): ${names.join(" · ") || "none"}`);

  for (const project of projects ?? []) {
    const expected = BADGES[project.name];
    if (!expected) continue;
    const same = Object.entries(expected).every(([k, v]) => project[k] === v);
    check(same, `${project.name}: ${project.status}, budget ${project.budget_state}, delayed ${project.is_delayed}, ${project.leaf_count} leaves`);
  }

  await supabase.auth.signOut();
}

console.log("\nwrong password");
{
  const supabase = newClient();
  const { error } = await supabase.auth.signInWithPassword({ email: "owner@civpms.test", password: `${password}x` });
  check(Boolean(error), `is rejected${error ? ` (${error.code ?? error.message})` : ""}`);
}

console.log(failures === 0 ? "\nAll demo-account checks passed." : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
