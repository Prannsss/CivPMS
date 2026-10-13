/**
 * F1 · Log in, sign up, forgot/reset password (spec §4.1, D10). Runs against the live Supabase
 * project; re-runnable (fresh accounts come from supabase/seed/f1-e2e.sql, see e2e/f1-support.ts).
 */
import { expect, test } from "@playwright/test";
import { loginAs, supabaseAs, ACCOUNTS } from "./helpers/auth";
import { toastWith } from "./helpers/ui";
import { claimFreshAccount, stamp } from "./f1-support";

test.describe("log in", () => {
  test("validates inline and explains a wrong password without saying which field", async ({ page }) => {
    await page.goto("/login");
    await expect(page.getByRole("heading", { level: 1, name: "Log in" })).toBeVisible();

    await page.getByRole("button", { name: "Log in", exact: true }).click();
    await expect(page.getByText("Enter your email address.")).toBeVisible();
    await expect(page.getByText("Enter your password.")).toBeVisible();

    await page.getByLabel("Email").fill("not-an-email");
    await page.getByLabel("Email").blur();
    await expect(page.getByText("Enter a valid email address, like name@company.com.")).toBeVisible();

    await page.getByLabel("Email").fill(ACCOUNTS.owner);
    await page.getByRole("textbox", { name: "Password (required)", exact: true }).fill(`wrong-${stamp()}`);
    await page.getByRole("button", { name: "Log in", exact: true }).click();
    await expect(page.getByRole("alert").filter({ hasText: "That email and password don't match" })).toBeVisible();
    await expect(page.getByRole("textbox", { name: "Password (required)", exact: true })).toBeFocused();
  });

  test("signs in and honours ?next=", async ({ page }) => {
    const password = process.env.DEMO_PASSWORD;
    test.skip(!password, "DEMO_PASSWORD is not set");
    await page.goto("/login?next=%2Fnotifications");
    await page.getByLabel("Email").fill(ACCOUNTS.pm);
    await page.getByRole("textbox", { name: "Password (required)", exact: true }).fill(password ?? "");
    await page.getByRole("button", { name: "Log in", exact: true }).click();
    await expect(page).toHaveURL(/\/notifications$/);
  });

  test("keeps what was typed before the page finished loading", async ({ page }) => {
    const password = process.env.DEMO_PASSWORD ?? "";
    test.skip(!password, "DEMO_PASSWORD is not set");
    // Type as soon as the HTML arrives, before React hydrates (slow phones on site).
    await page.goto("/login?next=%2Fnotifications", { waitUntil: "commit" });
    await page.getByLabel("Email").fill(ACCOUNTS.pm);
    await page.getByRole("textbox", { name: "Password (required)", exact: true }).fill(password);
    await page.waitForLoadState("networkidle");
    await expect(page.getByLabel("Email")).toHaveValue(ACCOUNTS.pm);
    await page.getByRole("button", { name: "Log in", exact: true }).click();
    await expect(page).toHaveURL(/\/notifications$/);
  });

  test("never redirects to another site", async ({ page }) => {
    const password = process.env.DEMO_PASSWORD ?? "";
    test.skip(!password, "DEMO_PASSWORD is not set");
    await page.goto("/login?next=https%3A%2F%2Fevil.example%2Fsteal");
    await page.getByLabel("Email").fill(ACCOUNTS.inspector);
    await page.getByRole("textbox", { name: "Password (required)", exact: true }).fill(password);
    await page.getByRole("button", { name: "Log in", exact: true }).click();
    await expect(page).toHaveURL(/localhost:\d+\/$/);
  });

  test("signed-in visitors skip the login page", async ({ page, context }) => {
    await loginAs(context, "owner");
    await page.goto("/login");
    await expect(page).toHaveURL(/localhost:\d+\/$/);
  });

  test("shows friendly messages for auth redirect errors", async ({ page }) => {
    await page.goto("/login?error=link_expired");
    await expect(page.getByRole("alert").filter({ hasText: "This link has expired. Request a new one." })).toBeVisible();
    await page.goto("/login?error=%3Cscript%3E");
    await expect(page.getByRole("form", { name: "Log in" }).getByRole("alert")).toHaveCount(0);
    await expect(page.getByText("<script>")).toHaveCount(0);
  });

  test("Google explains that it isn't set up yet", async ({ page }) => {
    await page.goto("/login");
    await page.getByTestId("google-sign-in").click();
    await expect(toastWith(page, "Google sign-in isn't set up yet")).toBeVisible();
    await expect(page).toHaveURL(/\/login$/);
  });
});

test.describe("sign up", () => {
  test("guides the password and maps server errors to the right field", async ({ page }) => {
    await page.goto("/signup?next=%2Finvite%2Fabc");
    await expect(page.getByRole("heading", { level: 1, name: "Sign up" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Log in" })).toHaveAttribute("href", "/login?next=%2Finvite%2Fabc");

    const password = page.getByRole("textbox", { name: "Password (required)", exact: true });
    await password.fill("short");
    await expect(page.getByTestId("password-strength")).toHaveAttribute("data-score", "1");
    await expect(page.getByText("Too short.")).toBeVisible();
    await password.fill("Bayanihan-Bridge-2026!");
    await expect(page.getByTestId("password-strength")).toHaveAttribute("data-score", "4");

    await password.fill("short");
    await page.getByLabel("Email").fill(`f1-signup-${stamp()}@civpms.test`);
    await page.getByRole("button", { name: "Create account" }).click();
    await expect(page.getByText("Use at least 10 characters for your password.")).toBeVisible();

    // Supabase rejects addresses that can't receive mail (the reserved .test domain) or, while its
    // built-in mailer is over its hourly cap, refuses to send. Either way the visitor gets a plain
    // explanation (EMAIL_SEND_FAILED / email field), never a raw provider error.
    await password.fill("Bayanihan-Bridge-2026!");
    await page.getByRole("button", { name: "Create account" }).click();
    await expect(
      page.getByRole("alert").filter({ hasText: /can't receive mail|couldn't send your confirmation email/ }),
    ).toBeVisible();
    await expect(page).toHaveURL(/\/signup/);
  });

  test("check-email page shows the address and a resend cooldown", async ({ page }) => {
    const email = `f1-check-${stamp()}@example.com`;
    await page.goto(`/check-email?email=${encodeURIComponent(email)}&type=signup`);
    await expect(page.getByRole("heading", { name: "Check your email" })).toBeVisible();
    await expect(page.getByText(email)).toBeVisible();
    await expect(page.getByTestId("resend-email")).toBeDisabled();
    await expect(page.getByTestId("resend-email")).toContainText(/Resend email in 0:\d\d|Resend email in 1:00/);
    await page.getByRole("link", { name: "Go back and change it" }).click();
    await expect(page).toHaveURL(/\/signup\?email=/);
    await expect(page.getByLabel("Email")).toHaveValue(email);
  });
});

test.describe("password reset", () => {
  test("requests a reset link without revealing whether the account exists", async ({ page }) => {
    const email = `f1-nobody-${stamp()}@civpms.test`;
    await page.goto("/login");
    await page.getByLabel("Email").fill(email);
    await page.getByRole("link", { name: "Forgot password?" }).click();
    await expect(page).toHaveURL(/\/forgot-password\?email=/);
    await expect(page.getByLabel("Email")).toHaveValue(email);
    await page.getByRole("button", { name: "Send reset link" }).click();
    await expect(page).toHaveURL(/\/check-email\?.*type=recovery/);
    await expect(page.getByText("Open it to choose a new password.")).toBeVisible();
  });

  test("an expired link explains what to do", async ({ page }) => {
    await page.goto("/reset-password");
    await expect(page.getByRole("heading", { name: "This reset link has expired" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Request a new link" })).toHaveAttribute("href", "/forgot-password");
  });

  test("sets a new password and continues to onboarding", async ({ page, context }) => {
    const account = await claimFreshAccount();
    const original = process.env.DEMO_PASSWORD ?? "";
    const temporary = `F1-reset-${stamp()}-Pass!`;
    await loginAs(context, { email: account.email });

    await page.goto("/reset-password");
    await expect(page.getByRole("heading", { name: "Set a new password" })).toBeVisible();
    await page.getByRole("textbox", { name: "New password (required)", exact: true }).fill(temporary);
    await page.getByRole("textbox", { name: "Confirm new password (required)", exact: true }).fill(`${temporary}x`);
    await page.getByRole("button", { name: "Update password" }).click();
    await expect(page.getByText("Passwords don't match.")).toBeVisible();

    await page.getByRole("textbox", { name: "Confirm new password (required)", exact: true }).fill(temporary);
    await page.getByRole("button", { name: "Update password" }).click();
    await expect(toastWith(page, "Password updated")).toBeVisible();
    await expect(page).toHaveURL(/\/onboarding$/);

    // Put the pool password back so the account stays usable.
    const { client } = await supabaseAs({ email: account.email, password: temporary });
    const { error } = await client.auth.updateUser({ password: original });
    expect(error?.code ?? null).toBeNull();
  });
});
