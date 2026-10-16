/**
 * F1 · Email-invitation landing page /invite/[token] (spec §4.4): works signed out, sends the
 * invitee through log in with `next`, blocks the wrong account, accepts and declines.
 */
import { expect, test } from "@playwright/test";
import { loginAs } from "./helpers/auth";
import { toastWith } from "./helpers/ui";
import { claimFreshAccount, F1_COMPANY, F1_PROJECT, inviteToF1Project, revokeF1Invitation, stamp } from "./f1-support";

test("an invalid link explains itself", async ({ page }) => {
  await page.goto(`/invite/${"0".repeat(64)}`);
  await expect(page.getByRole("heading", { name: "This invitation link doesn't work" })).toBeVisible();
  await page.goto("/invite/not-a-token");
  await expect(page.getByTestId("invite-invalid")).toBeVisible();
});

test("signed out → log in with next → name → accept → project", async ({ page }) => {
  const account = await claimFreshAccount();
  const { token } = await inviteToF1Project(account.email, "inspector");
  const password = process.env.DEMO_PASSWORD ?? "";

  await page.goto(`/invite/${token}`);
  await expect(page.getByRole("heading", { level: 1, name: `Join ${F1_PROJECT}` })).toBeVisible();
  await expect(page.getByText(F1_COMPANY).first()).toBeVisible();
  await expect(page.getByText("f***@civpms.test").first()).toBeVisible();
  await expect(page.getByTestId("invite-sign-up")).toHaveAttribute("href", `/signup?next=%2Finvite%2F${token}`);

  await page.getByTestId("invite-sign-in").click();
  await expect(page).toHaveURL(new RegExp(`/login\\?next=%2Finvite%2F${token}$`));
  await page.getByLabel("Email").fill(account.email);
  await page.getByRole("textbox", { name: "Password (required)", exact: true }).fill(password);
  await page.getByRole("button", { name: "Log in", exact: true }).click();

  // Not onboarded yet, but invitation links skip onboarding: accepting finishes it.
  await expect(page).toHaveURL(new RegExp(`/invite/${token}$`));
  await page.getByRole("button", { name: "Accept and open project" }).click();
  await expect(page.getByText("Enter your full name.")).toBeVisible();
  await page.getByLabel("Your full name").fill(`[F1] Ines Invitee ${stamp()}`);
  await page.getByRole("button", { name: "Accept and open project" }).click();

  await expect(page).toHaveURL(/\/projects\/[0-9a-f-]{36}$/);
  await expect(toastWith(page, `Welcome to ${F1_PROJECT}`)).toBeVisible();

  // The link is used up now.
  await page.goto(`/invite/${token}`);
  await expect(page.getByRole("heading", { name: "This invitation was already accepted" })).toBeVisible();
});

test("the wrong account is told to switch, and switching keeps the link", async ({ page, context }) => {
  const account = await claimFreshAccount();
  const invitation = await inviteToF1Project(account.email, "pm");
  try {
    await loginAs(context, "rival", { fresh: true });
    await page.goto(`/invite/${invitation.token}`);
    await expect(page.getByRole("heading", { name: "This invitation is for f***@civpms.test" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Accept and open project" })).toHaveCount(0);
    await page.getByRole("button", { name: "Switch account" }).click();
    await expect(page).toHaveURL(new RegExp(`/login\\?next=%2Finvite%2F${invitation.token}$`));
  } finally {
    await revokeF1Invitation(invitation.id);
  }
  // Revoked invitations say so.
  await page.goto(`/invite/${invitation.token}`);
  await expect(page.getByRole("heading", { name: "This invitation was cancelled" })).toBeVisible();
});

test("the invitee can decline", async ({ page, context }) => {
  const account = await claimFreshAccount();
  const { token } = await inviteToF1Project(account.email, "inspector");
  await loginAs(context, { email: account.email });
  await page.goto(`/invite/${token}`);
  await page.getByLabel("Your full name").fill(`[F1] Dina Decliner ${stamp()}`);
  await page.getByRole("button", { name: "Decline", exact: true }).click();
  const dialog = page.getByRole("alertdialog");
  await expect(dialog).toContainText(`Decline the invitation to ${F1_PROJECT}?`);
  await dialog.getByRole("button", { name: "Decline invitation" }).click();
  await expect(page.getByRole("heading", { name: "Invitation declined" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Finish setting up" })).toHaveAttribute("href", "/onboarding");

  await page.reload();
  await expect(page.getByRole("heading", { name: "This invitation was declined" })).toBeVisible();
});
