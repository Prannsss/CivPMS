import { expect, type Locator, type Page } from "@playwright/test";

/**
 * Opens the ⌘K / Ctrl+K command palette. Retries the shortcut until the dialog shows, because a
 * key press that lands before hydration has no listener yet.
 */
export async function openPalette(page: Page): Promise<Locator> {
  const palette = page.getByRole("dialog", { name: "Search and commands" });
  await expect(async () => {
    if (!(await palette.isVisible())) await page.keyboard.press("Control+k");
    await expect(palette).toBeVisible({ timeout: 1_500 });
  }).toPass({ timeout: 20_000 });
  return palette;
}

/** A snackbar (sonner toast) containing `text`. */
export function toastWith(page: Page, text: string | RegExp): Locator {
  return page.locator("[data-sonner-toast]").filter({ hasText: text });
}

/** Escapes text for use inside a RegExp (names like "[FOUND] QA Builders"). */
export function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Waits until the bell's Realtime subscription is live, so notifications created next arrive
 * without a reload (see src/components/app-shell/realtime-status.tsx).
 */
export async function waitForRealtime(page: Page): Promise<void> {
  await expect(page.getByTestId("notifications-realtime")).toHaveAttribute("data-state", "live", { timeout: 30_000 });
}
