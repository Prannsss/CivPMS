import { expect, test } from "@playwright/test";
import { loginAs, supabaseAs } from "./helpers/auth";
import { watchConsole } from "./helpers/f3-console";
import { F3, createF3Project, deleteF3Project, ensureF3Tenant, stamp } from "./helpers/f3-tenant";

/**
 * Project dashboard (spec §9.4): KPIs, budget, schedule overrun (§5.4), needs attention and recent
 * activity, per role. Demo projects are only read; the F3 project is created and trashed here.
 */

async function projectId(name: string): Promise<string> {
  const { client } = await supabaseAs("owner");
  const { data, error } = await client.from("projects").select("id").eq("name", name).is("deleted_at", null).single();
  if (error || !data) throw new Error(`Demo project "${name}" not found: ${error?.message}`);
  return data.id;
}

test("a delayed, over-budget project shows the overrun and what needs attention", async ({ page, context }) => {
  const console = watchConsole(page);
  const davao = await projectId("Davao Drainage Rehabilitation, Phase 2");
  await loginAs(context, "owner");
  await page.goto(`/projects/${davao}`);

  await expect(page.getByRole("heading", { level: 1, name: "Dashboard" })).toBeVisible();
  const banner = page.getByRole("region", { name: /days past the planned end date/ });
  await expect(banner).toBeVisible();
  await expect(banner.getByRole("link", { name: "Review end date" })).toHaveAttribute("href", `/projects/${davao}/settings#details`);

  await expect(page.getByText("Overall progress")).toBeVisible();
  await expect(page.getByText("Delayed activities")).toBeVisible();
  const attention = page.locator("[data-slot=card]").filter({ has: page.getByRole("heading", { name: "Needs attention" }) });
  await expect(attention.getByText(/^Over budget by ₱/)).toBeVisible();
  const delayedLink = attention.getByRole("link", { name: /passed \d+ days ago/ }).first();
  await expect(delayedLink).toHaveAttribute("href", new RegExp(`/projects/${davao}/wbs\\?activity=`));

  const budget = page.locator("[data-slot=card]").filter({ has: page.getByRole("heading", { name: "Budget", exact: true }) });
  await expect(budget.getByText("Over budget by")).toBeVisible();
  await expect(budget.getByRole("meter")).toHaveAttribute("data-state", "exceeded");
  await expect(page.getByRole("heading", { name: "Schedule" })).toBeVisible();
  await expect(page.getByText("Past the planned end date", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Site inspections" })).toBeVisible();
  await expect(page.getByText("Coming next", { exact: true })).toBeVisible();

  const recent = page.locator("[data-slot=card]").filter({ has: page.getByRole("heading", { name: "Recent activity" }) });
  await expect(recent.getByRole("listitem").first()).toBeVisible();
  await recent.getByRole("link", { name: "Open audit trail" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Audit Trail" })).toBeVisible();
  console.expectClean();
});

test("inspectors get a read-only dashboard; other tenants and unfinished accounts can't get in", async ({ page, context }) => {
  const console = watchConsole(page);
  const cebu = await projectId("Cebu Coastal Road Widening");

  await loginAs(context, "inspector");
  await page.goto(`/projects/${cebu}`);
  await expect(page.getByRole("heading", { level: 1, name: "Dashboard" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Open work breakdown" }).first()).toBeVisible();
  await expect(page.getByRole("link", { name: "Review end date" })).toHaveCount(0);
  await expect(page.getByRole("navigation", { name: "Project" }).getByRole("link", { name: "Project Settings" })).toHaveCount(0);
  console.expectClean();

  await loginAs(context, "rival");
  await page.goto(`/projects/${cebu}`);
  await expect(page.getByRole("heading", { level: 1, name: "Dashboard" })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "We couldn't open that project" })).toBeVisible();

  await loginAs(context, "newbie");
  await page.goto(`/projects/${cebu}`);
  await expect(page).toHaveURL(/\/onboarding/);
});

test("a fresh project asks for its work breakdown, then lists late and unplanned work", async ({ page, context }) => {
  const console = watchConsole(page);
  await ensureF3Tenant();
  const empty = await createF3Project({ name: `[F3] Dash Empty ${stamp()}` });
  const late = await createF3Project({
    name: `[F3] Dash Late ${stamp()}`,
    startDate: "2026-06-01",
    endDate: "2027-06-30",
    workPackages: [
      ["[F3] Retaining wall", 250_000, "2026-09-01"],
      ["[F3] Landscaping", null, null],
    ],
  });
  try {
    await loginAs(context, F3.owner);
    await page.goto(`/projects/${empty}`);
    await expect(page.getByText("No work breakdown yet")).toBeVisible();
    await expect(page.getByText("Nothing is running late")).toBeVisible();

    await page.goto(`/projects/${late}`);
    const attention = page.locator("[data-slot=card]").filter({ has: page.getByRole("heading", { name: "Needs attention" }) });
    // 40 h from Tue 1 Sep 2026 ends on Mon 7 Sep: long past, so derived Delayed (§10.5).
    const delayed = attention.getByRole("link", { name: /\[F3\] Retaining wall.*Planned end \(7 Sep 2026\) passed/ });
    await expect(delayed).toHaveAttribute("href", new RegExp(`/projects/${late}/wbs\\?activity=`));
    await expect(attention.getByRole("link", { name: /\[F3\] Landscaping.*Missing start date, duration and cost/ })).toBeVisible();
    await expect(page.getByText("1 work package not scheduled yet")).toBeVisible();
    await expect(page.getByText("[F3] Retaining wall").first()).toBeVisible();
    console.expectClean();
  } finally {
    await deleteF3Project(empty);
    await deleteF3Project(late);
  }
});
