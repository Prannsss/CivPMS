import { expect, test, type Page } from "@playwright/test";
import { loginAs, supabaseAs } from "./helpers/auth";
import { watchConsole } from "./helpers/f3-console";
import { escapeRegExp, toastWith } from "./helpers/ui";
import {
  F5,
  F5_COMPANY,
  F5_NAMES,
  F5_PENDING_EMAIL,
  F5_PROFILE_COMPANY,
  F5_PROJECT,
  ensureF5Member,
  ensureF5Tenant,
  stamp,
  type F5Tenant,
} from "./f5-tenant";

/**
 * Company settings (spec §2.2, §4.4, D11, D13) in the "[F5] Account QA Builders" tenant:
 * Owner PM renames the company (uniqueness shown inline), changes the default working calendar,
 * promotes/demotes and removes a member, creates/copies/turns off a company invite code; PMs see
 * a read-only company plus codes and invitations; inspectors see it read-only; someone without a
 * company gets a friendly panel. Everything is put back afterwards.
 */

test.describe.configure({ mode: "serial" });

let tenant: F5Tenant;

test.beforeAll(async () => {
  test.setTimeout(120_000);
  tenant = await ensureF5Tenant();
});

async function openSettings(page: Page) {
  await page.goto("/settings");
  await expect(page.getByRole("heading", { level: 1, name: "Company settings" })).toBeVisible();
}

test("owner renames the company; a taken name is explained inline", async ({ page, context }) => {
  const console = watchConsole(page);
  await loginAs(context, F5.owner);
  await openSettings(page);
  const form = page.getByRole("form", { name: "Rename company" });
  const name = form.getByRole("textbox", { name: /^Company name/ });
  await expect(name).toHaveValue(F5_COMPANY);
  const next = `${F5_COMPANY} ${stamp()}`;
  try {
    await name.fill(F5_PROFILE_COMPANY.toUpperCase());
    await form.getByRole("button", { name: "Save name" }).click();
    await expect(form.getByText("Another company already uses this name. Pick a different one.")).toBeVisible();

    await name.fill(next);
    await form.getByRole("button", { name: "Save name" }).click();
    await expect(toastWith(page, "Company renamed")).toBeVisible();
    await expect(page.getByRole("banner").getByText(next)).toBeVisible();
    const { client } = await supabaseAs(F5.owner);
    const { data } = await client.from("companies").select("name").eq("id", tenant.companyId).single();
    expect(data?.name).toBe(next);
  } finally {
    const { client } = await supabaseAs(F5.owner);
    await client.rpc("rename_company", { p_name: F5_COMPANY });
  }
  console.expectClean();
});

test("owner changes the default working calendar", async ({ page, context }) => {
  const console = watchConsole(page);
  await loginAs(context, F5.owner);
  await openSettings(page);
  const form = page.getByRole("form", { name: "Working calendar defaults" });
  const hours = form.getByRole("textbox", { name: /^Hours per day/ });
  try {
    await form.getByRole("button", { name: "Saturday" }).click();
    await expect(form.getByRole("button", { name: "Saturday" })).toHaveAttribute("aria-pressed", "true");
    await hours.fill("30");
    await hours.blur();
    await expect(form.getByText("A day has at most 24 hours.")).toBeVisible();
    await hours.fill("7.5");
    await expect(form.getByText("45 working hours per week")).toBeVisible();
    await form.getByRole("button", { name: "Save defaults" }).click();
    await expect(toastWith(page, "Working calendar defaults saved")).toBeVisible();
    const { client } = await supabaseAs(F5.owner);
    const { data } = await client.from("companies").select("default_work_days, default_hours_per_day").eq("id", tenant.companyId).single();
    expect(data?.default_work_days).toEqual([1, 2, 3, 4, 5, 6]);
    expect(Number(data?.default_hours_per_day)).toBe(7.5);
    await expect(form.getByRole("button", { name: "Save defaults" })).toBeDisabled();
  } finally {
    const { client } = await supabaseAs(F5.owner);
    await client.rpc("update_company_defaults", { p_work_days: [1, 2, 3, 4, 5], p_hours_per_day: 8 });
  }
  console.expectClean();
});

test("owner promotes, demotes and removes a member", async ({ page, context, browser }) => {
  const console = watchConsole(page);
  await ensureF5Member();
  await loginAs(context, F5.owner);
  await openSettings(page);
  const row = page.getByTestId(`member-${F5.member.email}`);
  await expect(row).toContainText(F5_NAMES.member);
  await expect(row).toContainText("Inspector / QA / QC");
  try {
    // Promote to PM.
    await row.getByRole("button", { name: `Manage ${F5_NAMES.member}` }).click();
    await page.getByRole("menuitemradio", { name: "Project Manager" }).click();
    await expect(toastWith(page, `${F5_NAMES.member} is now a Project Manager`)).toBeVisible();
    await expect(row).toContainText("Project Manager");

    // Demote again (confirm explains the impact).
    await row.getByRole("button", { name: `Manage ${F5_NAMES.member}` }).click();
    await page.getByRole("menuitemradio", { name: "Inspector / QA / QC" }).click();
    const demote = page.getByRole("alertdialog", { name: `Make ${F5_NAMES.member} an inspector?` });
    await expect(demote).toBeVisible();
    await demote.getByRole("button", { name: "Make inspector" }).click();
    await expect(toastWith(page, `${F5_NAMES.member} is now an inspector`)).toBeVisible();
    await expect(row).toContainText("Inspector / QA / QC");

    // Remove: cancel first, then confirm.
    await row.getByRole("button", { name: `Manage ${F5_NAMES.member}` }).click();
    await page.getByRole("menuitem", { name: "Remove from company" }).click();
    const dialog = page.getByRole("alertdialog", { name: new RegExp(`^Remove ${escapeRegExp(F5_NAMES.member)} from`) });
    await expect(dialog).toContainText("Their past updates stay in the audit trail");
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(dialog).toBeHidden();
    await expect(row).toBeVisible();

    await row.getByRole("button", { name: `Manage ${F5_NAMES.member}` }).click();
    await page.getByRole("menuitem", { name: "Remove from company" }).click();
    await dialog.getByRole("button", { name: "Remove from company" }).click();
    await expect(toastWith(page, `${F5_NAMES.member} was removed from`)).toBeVisible();
    await expect(row).toHaveCount(0);

    // The removed person now sees the "No company yet" panel.
    const removedContext = await browser.newContext();
    await loginAs(removedContext, F5.member, { fresh: true });
    const removedPage = await removedContext.newPage();
    const removedConsole = watchConsole(removedPage);
    await removedPage.goto("/settings");
    await expect(removedPage.getByRole("heading", { name: "You're not in a company yet" })).toBeVisible();
    await expect(removedPage.getByRole("link", { name: "Join a company" })).toBeVisible();
    removedConsole.expectClean();
    await removedContext.close();
  } finally {
    await ensureF5Member();
  }
  console.expectClean();
});

test("owner creates, copies and turns off a company invite code", async ({ page, context }) => {
  const console = watchConsole(page);
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await loginAs(context, F5.owner);
  await openSettings(page);
  await page.getByRole("button", { name: "New code" }).click();
  const dialog = page.getByRole("dialog", { name: "Create a company invite code" });
  await dialog.getByRole("combobox").click();
  await page.getByRole("option", { name: "30 days" }).click();
  const uses = dialog.getByRole("textbox", { name: /Usage limit/ });
  await uses.fill("abc");
  await dialog.getByRole("button", { name: "Create code" }).click();
  await expect(dialog.getByText("Enter a whole number from 1 to 1,000", { exact: false })).toBeVisible();
  await uses.fill("3");
  await dialog.getByRole("button", { name: "Create code" }).click();
  const created = toastWith(page, /Invite code [0-9A-Z]{4}-[0-9A-Z]{4} created/);
  await expect(created).toBeVisible();
  const code = /([0-9A-Z]{4}-[0-9A-Z]{4})/.exec((await created.textContent()) ?? "")?.[1] ?? "";
  expect(code).not.toBe("");
  const item = page.getByTestId(`invite-code-${code}`);
  await expect(item).toContainText("Active");
  await expect(item).toContainText("0 of 3 uses");

  await item.getByRole("button", { name: "Copy" }).click();
  await expect(toastWith(page, "Invite code copied")).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(code);

  await item.getByRole("button", { name: `Turn off code ${code}` }).click();
  const confirm = page.getByRole("alertdialog", { name: `Turn off code ${code}?` });
  await confirm.getByRole("button", { name: "Turn off code" }).click();
  await expect(toastWith(page, `Code ${code} turned off`)).toBeVisible();
  const { client } = await supabaseAs(F5.owner);
  const { data } = await client.from("invite_codes").select("revoked_at").eq("code", code).single();
  expect(data?.revoked_at).not.toBeNull();
  console.expectClean();
});

test("a company PM sees the company read-only, plus codes and invitations", async ({ page, context }) => {
  const console = watchConsole(page);
  await loginAs(context, F5.pm);
  await openSettings(page);
  await expect(page.getByText("You: Project Manager")).toBeVisible();
  await expect(page.getByRole("form", { name: "Rename company" })).toHaveCount(0);
  await expect(page.getByRole("form", { name: "Working calendar defaults" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /^Manage / })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Company invite codes" })).toBeVisible();
  await expect(page.getByRole("button", { name: "New code" })).toBeVisible();
  const invitations = page.locator("#invitations");
  await expect(invitations).toContainText(F5_PENDING_EMAIL);
  await expect(invitations.getByRole("link", { name: new RegExp(escapeRegExp(F5_PROJECT)) })).toHaveAttribute(
    "href",
    `/projects/${tenant.projectId}/collaborators`,
  );
  console.expectClean();
});

test("an inspector sees the company and members read-only", async ({ page, context }) => {
  const console = watchConsole(page);
  await loginAs(context, F5.inspector);
  await openSettings(page);
  await expect(page.getByText("You: Inspector / QA / QC")).toBeVisible();
  await expect(page.locator("#general")).toContainText(F5_COMPANY);
  await expect(page.getByTestId(`member-${F5.owner.email}`)).toContainText("Owner PM");
  await expect(page.getByRole("button", { name: /^Manage / })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Company invite codes" })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Pending invitations" })).toHaveCount(0);
  await expect(page.getByRole("columnheader", { name: "Projects" })).toHaveCount(0);
  console.expectClean();
});

test("tenants are isolated and people who haven't onboarded are sent to onboarding", async ({ page, context, browser }) => {
  const console = watchConsole(page);
  await loginAs(context, "rival");
  await openSettings(page);
  await expect(page.getByText("You: Owner PM")).toBeVisible();
  await expect(page.locator("#members")).not.toContainText(F5_NAMES.owner);
  await expect(page.getByTestId(`member-${F5.owner.email}`)).toHaveCount(0);
  await expect(page.getByText(F5_PENDING_EMAIL)).toHaveCount(0);
  console.expectClean();

  const newbieContext = await browser.newContext();
  await loginAs(newbieContext, "newbie");
  const newbie = await newbieContext.newPage();
  for (const path of ["/settings", "/profile", "/notifications"]) {
    await newbie.goto(path);
    await expect(newbie).toHaveURL(/\/onboarding/);
  }
  await newbieContext.close();
});
