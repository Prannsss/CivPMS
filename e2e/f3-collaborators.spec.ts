import { expect, test } from "@playwright/test";
import { loginAs, supabaseAs } from "./helpers/auth";
import { watchConsole } from "./helpers/f3-console";
import { F3, F3_NAMES, createF3Project, deleteF3Project, ensureF3Tenant, stamp } from "./helpers/f3-tenant";
import { toastWith } from "./helpers/ui";

/**
 * Collaborators (spec §4.4, D11): invite by email (test addresses can't receive mail, so the dialog
 * offers the link), plain-language invitee errors, resend / revoke, project invite codes and
 * removing a member. Each test uses its own "[F3] …" project.
 */

test.beforeAll(async () => {
  await ensureF3Tenant();
});

test("invite by email, resend and revoke, with plain-language errors", async ({ page, context }) => {
  const console = watchConsole(page);
  const id = await createF3Project({ name: `[F3] Team ${stamp()}` });
  const invitee = `f3-invitee-${stamp().replace(/[^0-9]/g, "")}@civpms.test`;
  try {
    await loginAs(context, F3.owner);
    await page.goto(`/projects/${id}/collaborators`);
    await expect(page.getByRole("heading", { level: 1, name: "Collaborators" })).toBeVisible();
    await expect(page.getByText("No pending invitations")).toBeVisible();

    await page.getByRole("button", { name: "Invite people" }).click();
    const dialog = page.getByRole("dialog");
    const email = dialog.getByLabel("Email address");

    // Errors appear next to the email, in plain language.
    await email.fill(F3.owner.email);
    await dialog.getByRole("button", { name: "Send invitation" }).click();
    await expect(dialog.getByText(/your own email/)).toBeVisible();
    await email.fill("rival@civpms.test");
    await dialog.getByRole("button", { name: "Send invitation" }).click();
    await expect(dialog.getByText(/already belongs to another company/)).toBeVisible();
    await email.fill("not-an-email");
    await email.blur();
    await expect(dialog.getByText(/Enter a valid email address/)).toBeVisible();

    await email.fill(invitee);
    await dialog.getByRole("radio", { name: "Project Manager" }).click();
    await dialog.getByRole("button", { name: "Send invitation" }).click();
    await expect(dialog.getByRole("heading", { name: `Invitation created for ${invitee}` })).toBeVisible();
    await expect(dialog.getByText(/test address that can't receive email/)).toBeVisible();
    await expect(dialog.getByLabel("Invitation link")).toHaveValue(/\/invite\/[A-Za-z0-9_-]{16,}/);
    await dialog.getByRole("button", { name: "Done" }).click();

    const row = page.getByRole("main").getByRole("listitem").filter({ hasText: invitee });
    await expect(row).toBeVisible();
    await expect(row.getByText("Project Manager")).toBeVisible();
    await expect(row.getByText(/Expires in 7 days|Expires in 6 days/)).toBeVisible();

    await row.getByRole("button", { name: "Resend" }).click();
    await expect(toastWith(page, `Invitation created for ${invitee}`)).toBeVisible();

    await row.getByRole("button", { name: `More actions for ${invitee}` }).click();
    await page.getByRole("menuitem", { name: "Revoke invitation" }).click();
    await page.getByRole("alertdialog").getByRole("button", { name: "Revoke invitation" }).click();
    await expect(toastWith(page, `Invitation to ${invitee} revoked`)).toBeVisible();
    await expect(page.getByRole("main").getByRole("listitem").filter({ hasText: invitee })).toHaveCount(0);
    console.expectClean();
  } finally {
    await deleteF3Project(id);
  }
});

test("project invite codes: create, copy and turn off", async ({ page, context }) => {
  const console = watchConsole(page);
  const id = await createF3Project({ name: `[F3] Codes ${stamp()}` });
  try {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await loginAs(context, F3.owner);
    await page.goto(`/projects/${id}/collaborators`);
    await page.getByRole("button", { name: "Create invite code" }).click();
    const dialog = page.getByRole("dialog", { name: "Create an invite code" });
    await dialog.getByLabel("Usage limit").fill("0");
    await dialog.getByRole("button", { name: "Create code" }).click();
    await expect(dialog.getByText(/whole number from 1 to 1,000/)).toBeVisible();
    await dialog.getByLabel("Usage limit").fill("3");
    await dialog.getByRole("button", { name: "Create code" }).click();

    const created = toastWith(page, /Invite code [0-9A-Z]{4}-[0-9A-Z]{4} created/);
    await expect(created).toBeVisible();
    const code = /([0-9A-Z]{4}-[0-9A-Z]{4})/.exec((await created.textContent()) ?? "")?.[1];
    expect(code).toBeTruthy();

    const row = page.getByRole("main").getByRole("listitem").filter({ hasText: code! });
    await expect(row.getByText("0 of 3 uses")).toBeVisible();
    await expect(row.getByText("Expires", { exact: false })).toBeVisible();
    await row.getByRole("button", { name: "Copy" }).click();
    await expect(toastWith(page, "Invite code copied")).toBeVisible();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(code);

    await row.getByRole("button", { name: "Turn off" }).click();
    await page.getByRole("alertdialog").getByRole("button", { name: "Turn off code" }).click();
    await expect(toastWith(page, `Code ${code} turned off`)).toBeVisible();
    await expect(page.getByRole("main").getByRole("listitem").filter({ hasText: code! }).getByText("Turned off", { exact: true })).toBeVisible();
    console.expectClean();
  } finally {
    await deleteF3Project(id);
  }
});

test("managers remove members from the project only; inspectors see a read-only list", async ({ page, context }) => {
  const console = watchConsole(page);
  const id = await createF3Project({ name: `[F3] Remove ${stamp()}`, members: ["inspector"] });
  try {
    await loginAs(context, F3.inspector);
    await page.goto(`/projects/${id}/collaborators`);
    await expect(page.getByText(F3_NAMES.owner)).toBeVisible();
    await expect(page.getByRole("button", { name: "Invite people" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /^Remove / })).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Pending invitations" })).toHaveCount(0);

    await loginAs(context, F3.owner);
    await page.goto(`/projects/${id}/collaborators`);
    await page.getByRole("button", { name: `Remove ${F3_NAMES.inspector}` }).click();
    const confirm = page.getByRole("alertdialog", { name: `Remove ${F3_NAMES.inspector} from this project?` });
    await expect(confirm.getByText(/stays in your company/)).toBeVisible();
    await confirm.getByRole("button", { name: "Remove from project" }).click();
    await expect(toastWith(page, `${F3_NAMES.inspector} was removed from the project`)).toBeVisible();
    await expect(page.getByRole("button", { name: `Remove ${F3_NAMES.inspector}` })).toHaveCount(0);

    // Still in the company (removal is per project).
    const { client } = await supabaseAs(F3.owner);
    const { inspectorId } = await ensureF3Tenant();
    const member = await client.from("company_members").select("role").eq("user_id", inspectorId).maybeSingle();
    expect(member.data?.role).toBe("inspector");
    console.expectClean();
  } finally {
    await deleteF3Project(id);
  }
});
