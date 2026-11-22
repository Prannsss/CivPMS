import { expect, test, type Page } from "@playwright/test";
import { loginAs, supabaseAs } from "./helpers/auth";
import { watchConsole } from "./helpers/f3-console";
import { F3, createF3Project, deleteF3Project, ensureF3Tenant, stamp } from "./helpers/f3-tenant";
import { escapeRegExp, toastWith } from "./helpers/ui";

/**
 * Project Settings (spec §5): details with optimistic concurrency, the status machine with reason
 * dialogs and blocked completion, archive with Undo, delete with type-the-name + Undo, and the
 * managers-only rule. Every test works on its own "[F3] …" project in the F3 tenant.
 */

test.beforeAll(async () => {
  await ensureF3Tenant();
});

async function bumpVersion(projectId: string, patch: Record<string, string | number>): Promise<void> {
  const { client } = await supabaseAs(F3.owner);
  const { data } = await client.from("projects").select("version").eq("id", projectId).single();
  const { error } = await client.rpc("update_project", { p_project_id: projectId, p_patch: patch, p_expected_version: data?.version ?? 0 });
  if (error) throw new Error(`update_project failed: ${error.message}`);
}

const saveButton = (page: Page) => page.getByRole("button", { name: "Save", exact: true });

async function saveAndExpectConflict(page: Page) {
  await saveButton(page).click();
  await expect(page.getByRole("alert").filter({ hasText: "Changed by someone else just now" })).toBeVisible();
}

test("details save, and a concurrent edit offers Reload or Keep mine", async ({ page, context }) => {
  const console = watchConsole(page);
  const name = `[F3] Settings ${stamp()}`;
  const id = await createF3Project({ name });
  try {
    await loginAs(context, F3.owner);
    await page.goto(`/projects/${id}/settings`);
    await expect(page.getByRole("heading", { level: 1, name: "Project Settings" })).toBeVisible();

    // Read-only first; the pencil opens the form and turns into Cancel + Save.
    const details = page.getByRole("region", { name: "Details" });
    await expect(details.getByRole("textbox")).toHaveCount(0);
    await details.getByRole("button", { name: "Edit details" }).click();
    const site = page.getByLabel("Site name or location");
    await site.fill("[F3] Lapu-Lapu pier");
    await saveButton(page).click();
    await expect(toastWith(page, "Project details saved")).toBeVisible();
    await expect(details.getByRole("button", { name: "Edit details" })).toBeFocused();
    await expect(details.getByText("[F3] Lapu-Lapu pier")).toBeVisible();

    // Cancel (and Esc) leave without saving.
    await details.getByRole("button", { name: "Edit details" }).click();
    await site.fill("[F3] Not saved");
    await page.keyboard.press("Escape");
    await page.getByRole("alertdialog", { name: "Discard your changes?" }).getByRole("button", { name: "Discard changes" }).click();
    await expect(details.getByText("[F3] Not saved")).toHaveCount(0);
    await details.getByRole("button", { name: "Edit details" }).click();

    // Validation: inline, on blur, with how to fix it.
    const threshold = page.getByLabel("Near Budget Limit warning");
    await threshold.fill("40");
    await threshold.blur();
    await expect(page.getByText(/Use at least 50%/)).toBeVisible();
    await threshold.fill("85");

    // Someone else saves first → Keep mine.
    await bumpVersion(id, { description: "[F3] Edited elsewhere" });
    const budget = page.getByLabel("Estimated project budget");
    await budget.click();
    await budget.press("ControlOrMeta+a");
    await budget.pressSequentially("6200000");
    await budget.blur();
    await saveAndExpectConflict(page);
    await page.getByRole("button", { name: "Keep mine" }).click();
    await expect(page.getByRole("alert").filter({ hasText: "Changed by someone else just now" })).toHaveCount(0);
    await expect(details.getByRole("button", { name: "Edit details" })).toBeVisible();
    const { client } = await supabaseAs(F3.owner);
    await expect
      .poll(async () => {
        const saved = await client.from("projects").select("budget, near_budget_threshold").eq("id", id).single();
        return [Number(saved.data?.budget), Number(saved.data?.near_budget_threshold)];
      })
      .toEqual([6_200_000, 0.85]);

    // … and → Reload shows their version.
    await bumpVersion(id, { site_name: "[F3] Changed by a colleague" });
    await details.getByRole("button", { name: "Edit details" }).click();
    await site.fill("[F3] My unsaved site");
    await saveAndExpectConflict(page);
    await page.getByRole("button", { name: "Reload" }).click();
    await expect(details.getByText("[F3] Changed by a colleague")).toBeVisible();
    console.expectClean();
  } finally {
    await deleteF3Project(id);
  }
});

test("status changes follow the project lifecycle", async ({ page, context }) => {
  const console = watchConsole(page);
  const name = `[F3] Lifecycle ${stamp()}`;
  const id = await createF3Project({ name, workPackages: [["[F3] Survey", 120_000]] });
  try {
    await loginAs(context, F3.owner);
    await page.goto(`/projects/${id}/settings?section=status`);
    const status = page.getByRole("region", { name: "Status" });

    await status.getByRole("button", { name: "Start the project" }).click();
    await page.getByRole("alertdialog").getByRole("button", { name: "Start project" }).click();
    await expect(toastWith(page, `${name} is now Active`)).toBeVisible();
    await expect(toastWith(page, "Baseline v1 was captured")).toBeVisible();

    // Completing is blocked while work is open, with links into the WBS.
    await expect(status.getByRole("button", { name: "Mark as completed" })).toBeDisabled();
    await expect(status.getByText("2 activities are not completed yet.", { exact: false })).toBeVisible();
    await status.getByText("Complete these activities first").click();
    await expect(status.getByRole("link", { name: /\[F3\] Survey/ })).toHaveAttribute("href", new RegExp(`/projects/${id}/wbs\\?activity=`));

    // On-Hold needs a reason.
    await status.getByRole("button", { name: "Put on hold" }).click();
    const dialog = page.getByRole("dialog", { name: /Put .* on hold\?/ });
    await dialog.getByRole("button", { name: "Put on hold" }).click();
    await expect(dialog.getByText(/Add a reason for putting the project on hold/)).toBeVisible();
    await dialog.getByLabel("Reason").fill("[F3] Waiting for the barangay permit");
    await dialog.getByRole("button", { name: "Put on hold" }).click();
    await expect(toastWith(page, "Status changed to On-Hold")).toBeVisible();
    await expect(status.getByText("[F3] Waiting for the barangay permit")).toBeVisible();

    await status.getByRole("button", { name: "Resume work" }).click();
    await expect(toastWith(page, "Status changed to Active")).toBeVisible();

    // The Owner PM can cancel (reason + danger confirmation).
    await status.getByRole("button", { name: "Cancel project" }).click();
    const cancel = page.getByRole("dialog", { name: /Cancel .*\?/ });
    await cancel.getByLabel("Reason").fill("[F3] Client terminated the contract");
    await cancel.getByRole("button", { name: "Cancel project" }).click();
    await expect(toastWith(page, "Status changed to Cancelled")).toBeVisible();

    // Archive with Undo.
    await status.getByRole("button", { name: "Archive", exact: true }).click();
    const archived = toastWith(page, "Project archived");
    await expect(archived).toBeVisible();
    await expect(status.getByRole("button", { name: "Unarchive" })).toBeVisible();
    await archived.getByRole("button", { name: "Undo" }).click();
    await expect(status.getByRole("button", { name: "Archive", exact: true })).toBeVisible();
    console.expectClean();
  } finally {
    await deleteF3Project(id);
  }
});

test("the Owner PM deletes a project with type-the-name and can undo it", async ({ page, context }) => {
  const console = watchConsole(page);
  const name = `[F3] Delete ${stamp()}`;
  const id = await createF3Project({ name });
  try {
    await loginAs(context, F3.owner);
    await page.goto(`/projects/${id}/settings`);
    await page.getByRole("tab", { name: /Danger zone/ }).click();
    await page.getByRole("button", { name: "Delete project" }).click();
    const confirm = page.getByRole("alertdialog", { name: `Delete "${name}"?` });
    await expect(confirm.getByRole("button", { name: "Delete project" })).toBeDisabled();
    await confirm.getByLabel(new RegExp(`Type ${escapeRegExp(name)} to confirm`)).fill(name);
    await confirm.getByRole("button", { name: "Delete project" }).click();

    await expect(page).toHaveURL(/\/$/);
    const toast = toastWith(page, "moved to Recently deleted");
    await expect(toast).toBeVisible();
    await toast.getByRole("button", { name: "Undo" }).click();
    await expect(toastWith(page, "Project restored")).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`/projects/${id}$`));
    await expect(page.getByRole("heading", { level: 1, name: "Dashboard" })).toBeVisible();
    console.expectClean();
  } finally {
    await deleteF3Project(id);
  }
});

test("project PMs edit but can't delete or cancel; inspectors get a friendly 403", async ({ page, context }) => {
  const console = watchConsole(page);
  const { baseProjectId } = await ensureF3Tenant();

  await loginAs(context, F3.pm);
  await page.goto(`/projects/${baseProjectId}/settings`);
  await expect(page.getByRole("heading", { level: 1, name: "Project Settings" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Edit details" })).toBeVisible();
  await expect(page.getByRole("tab", { name: /Danger zone/ })).toHaveCount(0);
  await page.getByRole("tab", { name: /Status/ }).click();
  await expect(page.getByRole("button", { name: "Cancel project" })).toHaveCount(0);

  await loginAs(context, F3.inspector);
  await page.goto(`/projects/${baseProjectId}/settings`);
  await expect(page.getByRole("heading", { name: "You can't change this project's settings" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Back to dashboard" })).toBeVisible();
  console.expectClean();
});
