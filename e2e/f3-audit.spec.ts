import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import { loginAs } from "./helpers/auth";
import { watchConsole } from "./helpers/f3-console";
import { F3, F3_NAMES, createF3Project, deleteF3Project, ensureF3Tenant, stamp } from "./helpers/f3-tenant";

/**
 * Audit Trail (spec §10.6): grouped by day, filters synced to the URL, keyset "Load more" and the
 * CSV export (filters, RLS, Manila time, ₱). Builds a project with more than one page of entries.
 */

test.beforeAll(async () => {
  await ensureF3Tenant();
});

test("filters, load more and CSV export", async ({ page, context }) => {
  test.setTimeout(180_000);
  const console = watchConsole(page);
  const name = `[F3] Audit ${stamp()}`;
  const workPackages = Array.from({ length: 52 }, (_, i): [string, number] => [`[F3] WP ${String(i + 1).padStart(2, "0")}`, 10_000 + i]);
  const id = await createF3Project({ name, workPackages, members: ["inspector"] });
  try {
    await loginAs(context, F3.owner);
    await page.goto(`/projects/${id}/audit`);
    await expect(page.getByRole("heading", { level: 1, name: "Audit Trail" })).toBeVisible();
    await expect(page.getByRole("heading", { level: 2, name: /^Today/ })).toBeVisible();

    // 1 project + 1 deliverable + 52 work packages + joins/invitation entries > one page of 50.
    await expect(page.getByText(/^Showing 50 of \d+ entries$/)).toBeVisible();
    await page.getByRole("button", { name: "Load more" }).click();
    await expect(page.getByText(/^Showing (\d+) of \1 entries$/)).toBeVisible();
    await expect(page.getByText(`Created project "${name}"`)).toBeVisible();
    await expect(page.getByRole("button", { name: "Load more" })).toHaveCount(0);

    // Text search (debounced, URL-synced).
    await page.getByLabel("Search the audit trail").fill("WP 07");
    await expect(page).toHaveURL(/\?q=WP\+07/);
    await expect(page.getByText(/^Showing 1 of 1 entry$/)).toBeVisible();
    await expect(page.getByText("Added 1.7 [F3] WP 07")).toBeVisible();

    // Type filter.
    await page.getByLabel("Search the audit trail").fill("");
    await expect(page).not.toHaveURL(/q=/);
    await page.getByRole("combobox", { name: "Type" }).click();
    await page.getByRole("option", { name: "Team & invitations" }).click();
    await expect(page).toHaveURL(/type=team/);
    await expect(page.getByText(`${F3_NAMES.inspector} joined the project as Inspector`)).toBeVisible();
    await expect(page.getByText("Added 1.7 [F3] WP 07")).toHaveCount(0);

    // Escalations only: none yet → a helpful empty state with Clear.
    await page.getByRole("switch", { name: /Escalations only/ }).click();
    await expect(page).toHaveURL(/escalations=1/);
    await expect(page.getByRole("heading", { name: "No entries match these filters" })).toBeVisible();
    await page.getByRole("button", { name: "Clear all filters" }).click();
    await expect(page).toHaveURL(new RegExp(`/projects/${id}/audit$`));

    // Export what is shown (project type filter).
    await page.goto(`/projects/${id}/audit?type=project`);
    const downloadPromise = page.waitForEvent("download");
    await page.getByRole("link", { name: "Export CSV" }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(/^f3-audit-[a-z0-9-]+-audit-\d{4}-\d{2}-\d{2}\.csv$/);
    const csv = await readFile((await download.path())!, "utf8");
    expect(csv.startsWith(`﻿Project,${name}`)).toBe(true);
    expect(csv).toContain("Filters,Type: Project details");
    expect(csv).toContain("Recorded (Asia/Manila),Observed (Asia/Manila),Person,Type,Action");
    expect(csv).toContain(`Created project ""${name}""`);
    expect(csv).toContain("Budget: ₱5,000,000.00"); // the create entry snapshot, in pesos
    expect(csv).not.toContain("[F3] WP 07");
    console.expectClean();

    // Inspectors can read and export too (A4).
    await loginAs(context, F3.inspector);
    await page.goto(`/projects/${id}/audit`);
    await expect(page.getByRole("link", { name: "Export CSV" })).toBeVisible();
    await expect(page.getByText(/^Showing 50 of \d+ entries$/)).toBeVisible();
  } finally {
    await deleteF3Project(id);
  }
});

test("the export refuses people who can't see the project", async ({ page, context }) => {
  const { baseProjectId } = await ensureF3Tenant();
  await loginAs(context, "rival");
  const response = await page.request.get(`/projects/${baseProjectId}/audit/export`);
  expect(response.status()).toBe(404);
  expect(await response.text()).toMatch(/couldn't find that project/);
});
