/**
 * F1 · Onboarding (mockup 5, spec §4.1–4.3, D10–D12): name → role → company (PM) or join
 * (inspector). Each test uses a fresh pool account (supabase/seed/f1-e2e.sql) and tags what it
 * creates with "[F1]".
 */
import { expect, test, type Page } from "@playwright/test";
import { loginAs } from "./helpers/auth";
import { escapeRegExp, toastWith } from "./helpers/ui";
import {
  claimFreshAccount,
  createF1InviteCode,
  ensureF1Tenant,
  F1_COMPANY,
  F1_PROJECT,
  inviteToF1Project,
  revokeF1InviteCode,
  stamp,
} from "./f1-support";

const progress = (page: Page) => page.getByTestId("onboarding-progress");

async function nameAndRole(page: Page, name: string, role: "Project Manager" | "Inspector / QA / QC") {
  await expect(progress(page)).toHaveAttribute("data-step", "1");
  await page.getByLabel("Full name").fill(name);
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(progress(page)).toHaveAttribute("data-step", "2");
  await page.getByRole("radio", { name: role }).click();
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(progress(page)).toHaveAttribute("data-step", "3");
}

test("a new Project Manager creates their company", async ({ page, context }) => {
  const account = await claimFreshAccount();
  const name = `[F1] Pia Manalo ${stamp()}`;
  const company = `[F1] Co ${stamp()}`;
  await loginAs(context, { email: account.email });

  // The app sends people who haven't finished onboarding here.
  await page.goto("/");
  await expect(page).toHaveURL(/\/onboarding$/);
  await expect(progress(page)).toHaveAttribute("data-step", "1");

  // Step 1: the name is required.
  await page.getByLabel("Full name").fill("");
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByText("Enter your full name.")).toBeVisible();
  await page.getByLabel("Full name").fill(name);
  await page.getByRole("button", { name: "Continue" }).click();

  // Step 2: a role is required; Back keeps what was typed.
  await expect(progress(page)).toHaveAttribute("data-step", "2");
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByText("Choose your role: Project Manager or Inspector / QA / QC.")).toBeVisible();
  await page.getByRole("button", { name: "Back" }).click();
  await expect(page.getByLabel("Full name")).toHaveValue(name);
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("radio", { name: "Project Manager" }).click();
  await page.getByRole("button", { name: "Continue" }).click();

  // Step 3: live availability check, then create.
  await expect(progress(page)).toHaveAttribute("data-step", "3");
  const companyField = page.getByTestId("company-name");
  await companyField.fill("  dela cruz   BUILDERS ");
  await expect(page.getByText("A company with this name already exists. Ask its Owner PM to invite you.")).toBeVisible();
  await companyField.fill(company);
  await expect(page.getByText(`${company} is available`, { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Create company" }).click();

  await expect(page).toHaveURL(/localhost:\d+\/$/);
  await expect(toastWith(page, "Welcome to CivPMS")).toBeVisible();
  await expect(page.getByText(company).first()).toBeVisible();

  // Onboarded people don't see onboarding again.
  await page.goto("/onboarding");
  await expect(page).toHaveURL(/localhost:\d+\/$/);
});

test("an inspector without a code finishes in “No company yet”", async ({ page, context }) => {
  const account = await claimFreshAccount();
  await loginAs(context, { email: account.email });
  await page.goto("/onboarding");
  await nameAndRole(page, `[F1] Ivan Inspector ${stamp()}`, "Inspector / QA / QC");

  await expect(page.getByRole("heading", { level: 1, name: "Join your team" })).toBeVisible();
  await page.getByRole("button", { name: "I don't have a code yet" }).click();
  await expect(page).toHaveURL(/localhost:\d+\/$/);
  await expect(page.getByTestId("no-company-state")).toBeVisible();
  await expect(page.getByText(account.email).first()).toBeVisible();
});

test("an inspector joins with an invite code", async ({ page, context }) => {
  await ensureF1Tenant();
  const code = await createF1InviteCode();
  const account = await claimFreshAccount();
  try {
    await loginAs(context, { email: account.email });
    await page.goto("/onboarding");
    await nameAndRole(page, `[F1] Rosa Reyes ${stamp()}`, "Inspector / QA / QC");

    // A wrong code explains itself; the real one previews the company before joining.
    const input = page.getByRole("textbox", { name: "Invite code (required)", exact: true });
    await input.fill("ZZZZ-ZZZZ");
    await page.getByRole("button", { name: "Check code" }).click();
    await expect(page.getByText(/not valid|Codes look like/i).first()).toBeVisible();
    await input.fill(code.code.replace("-", "").toLowerCase());
    await expect(input).toHaveValue(code.code);
    await page.getByRole("button", { name: "Check code" }).click();
    await expect(page.getByRole("heading", { name: new RegExp(`Join ${escapeRegExp(F1_COMPANY)}`) })).toBeVisible();
    await page.getByRole("button", { name: `Join ${F1_COMPANY}` }).click();

    await expect(page).toHaveURL(/localhost:\d+\/$/);
    await expect(toastWith(page, `Welcome to ${F1_COMPANY}`)).toBeVisible();
  } finally {
    await revokeF1InviteCode(code.id);
  }
});

test("a PM with a pending invitation sees it first and can accept it", async ({ page, context }) => {
  const account = await claimFreshAccount();
  await inviteToF1Project(account.email, "pm");
  await loginAs(context, { email: account.email });
  await page.goto("/onboarding");
  await nameAndRole(page, `[F1] Paolo Pascual ${stamp()}`, "Project Manager");

  await expect(page.getByRole("heading", { level: 1, name: "Join a team or start your company" })).toBeVisible();
  const card = page.getByTestId("pending-invitation").filter({ hasText: F1_PROJECT });
  await expect(card).toBeVisible();
  await expect(page.getByRole("button", { name: "Create company" })).toBeVisible();

  await card.getByRole("button", { name: `Accept invitation to ${F1_PROJECT}` }).click();
  const dialog = page.getByRole("alertdialog");
  await expect(dialog).toContainText(`Join ${F1_COMPANY}?`);
  await dialog.getByRole("button", { name: `Join ${F1_COMPANY}` }).click();

  await expect(page).toHaveURL(/\/projects\/[0-9a-f-]{36}$/);
  await expect(toastWith(page, `You joined ${F1_PROJECT}`)).toBeVisible();
});
