import { expect, test } from "@playwright/test";

/** Design-system smoke tests against the dev-only /dev/styleguide page. */
test.describe("styleguide", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/dev/styleguide");
    await expect(page.getByRole("heading", { level: 1, name: "CivPMS design system" })).toBeVisible();
  });

  test("every token pair passes WCAG AA in the light theme", async ({ page }) => {
    await expect(page.getByText(/All \d+ pairs pass \(light\)/)).toBeVisible();
  });

  test("switches to dark mode and back", async ({ page }) => {
    const html = page.locator("html");
    await page.getByRole("radio", { name: "Dark" }).first().click();
    await expect(html).toHaveClass(/\bdark\b/);
    await expect(page.getByText(/All \d+ pairs pass \(dark\)/)).toBeVisible();
    await page.getByRole("radio", { name: "Light" }).first().click();
    await expect(html).not.toHaveClass(/\bdark\b/);
  });

  test("type-to-confirm keeps the destructive button disabled until the name matches", async ({ page }) => {
    await page.getByRole("button", { name: "Type to confirm", exact: true }).click();
    const dialog = page.getByRole("alertdialog");
    await expect(dialog).toBeVisible();
    const confirm = dialog.getByRole("button", { name: "Cancel project" });
    await expect(confirm).toBeDisabled();
    await dialog.getByRole("textbox").fill("Cebu Coastal Road Widening");
    await expect(confirm).toBeEnabled();
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
  });

  test("undo snackbar offers an Undo action", async ({ page }) => {
    await page.getByRole("button", { name: "Undo", exact: true }).first().click();
    const toast = page.locator("[data-sonner-toast]").filter({ hasText: "Work package moved to 2.1" });
    await expect(toast).toBeVisible();
    await toast.getByRole("button", { name: "Undo" }).click();
    await expect(page.locator("[data-sonner-toast]").filter({ hasText: "Move undone" })).toBeVisible();
  });

  test("Ctrl+K opens the command palette", async ({ page }) => {
    await page.keyboard.press("Control+k");
    const palette = page.getByRole("dialog", { name: /command palette|search/i });
    await expect(palette).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(palette).toBeHidden();
  });

  test("has no horizontal overflow on a phone", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });
});
