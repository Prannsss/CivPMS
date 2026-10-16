import { expect, test } from "@playwright/test";
import { loginAs, supabaseAs } from "./helpers/auth";
import { watchConsole } from "./helpers/f3-console";
import { toastWith } from "./helpers/ui";
import { F5, F5_NAMES, ensureF5Tenant, makeAvatarPng, canSignIn, restorePassword, stamp } from "./f5-tenant";

/**
 * Profile (spec §2, §14): name, photo (browser resize → Supabase Storage when no media service is
 * configured), duration unit, theme, notification preferences + daily digest, password and sign
 * out. Everything runs as f5-profile@civpms.test and is put back at the end of each test.
 */

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  await ensureF5Tenant();
});

async function profileRow() {
  const { client, userId } = await supabaseAs(F5.profile);
  const { data, error } = await client.from("profiles").select("full_name, avatar_url, duration_unit, notification_prefs").eq("id", userId).single();
  if (error || !data) throw new Error(`read profile: ${error?.message}`);
  return { ...data, userId };
}

test("change the name with inline validation", async ({ page, context }) => {
  const console = watchConsole(page);
  await loginAs(context, F5.profile);
  await page.goto("/profile");
  await expect(page.getByRole("heading", { level: 1, name: "Profile" })).toBeVisible();
  const name = page.getByLabel("Full name");
  await expect(name).toHaveValue(F5_NAMES.profile);
  try {
    await name.fill(" ");
    await name.blur();
    await expect(page.getByText("Enter your full name.")).toBeVisible();
    const next = `${F5_NAMES.profile} ${stamp()}`;
    await name.fill(next);
    await page.getByRole("button", { name: "Save name" }).click();
    await expect(toastWith(page, "Name updated")).toBeVisible();
    expect((await profileRow()).full_name).toBe(next);
    await page.reload();
    await expect(page.getByLabel("Full name")).toHaveValue(next);
    await expect(page.getByText("Welcome back, Pia")).toBeVisible();
  } finally {
    const { client } = await supabaseAs(F5.profile);
    await client.rpc("update_profile", { p_patch: { full_name: F5_NAMES.profile } });
  }
  await expect(page.getByRole("textbox", { name: "Email" })).toHaveValue(F5.profile.email);
  console.expectClean();
});

test("upload, remove with Undo, and remove a profile photo", async ({ page, context }) => {
  const console = watchConsole(page);
  await loginAs(context, F5.profile);
  await page.goto("/profile");
  await expect(page.getByRole("button", { name: "Upload photo" })).toBeVisible();
  const png = await makeAvatarPng(page);
  try {
    await page.getByTestId("avatar-file-input").setInputFiles({ name: "site-photo.png", mimeType: "image/png", buffer: png });
    await expect(toastWith(page, "Photo added")).toBeVisible();
    const row = await profileRow();
    expect(row.avatar_url).toMatch(new RegExp(`/storage/v1/object/public/avatars/${row.userId}/[0-9a-f-]+\\.webp$`));
    // The browser resized it to a 256 px square WebP in the avatars bucket.
    const stored = await page.request.get(row.avatar_url ?? "");
    expect(stored.status()).toBe(200);
    expect(stored.headers()["content-type"]).toContain("image/webp");
    const size = await page.evaluate(async (url) => {
      const bitmap = await createImageBitmap(await (await fetch(url)).blob());
      return [bitmap.width, bitmap.height];
    }, row.avatar_url ?? "");
    expect(size).toEqual([256, 256]);
    await expect(page.getByRole("button", { name: "Change profile photo" }).locator("img")).toHaveAttribute("src", row.avatar_url ?? "");

    // Remove → Undo restores the same photo.
    await page.getByRole("button", { name: "Remove", exact: true }).click();
    const removed = toastWith(page, "Photo removed");
    await expect(removed).toBeVisible();
    expect((await profileRow()).avatar_url).toBeNull();
    await removed.getByRole("button", { name: "Undo" }).click();
    await expect(toastWith(page, "Photo restored")).toBeVisible();
    expect((await profileRow()).avatar_url).toBe(row.avatar_url);

    // A file that isn't an image is refused before any upload.
    await page.getByTestId("avatar-file-input").setInputFiles({ name: "notes.txt", mimeType: "text/plain", buffer: Buffer.from("hello") });
    await expect(toastWith(page, "Photo not uploaded")).toContainText("Pick a JPG, PNG, WebP, GIF or HEIC image.");
  } finally {
    const { client } = await supabaseAs(F5.profile);
    const current = (await profileRow()).avatar_url;
    await client.rpc("update_profile", { p_patch: { avatar_url: null } });
    const path = current?.split("/storage/v1/object/public/avatars/")[1];
    if (path) await client.storage.from("avatars").remove([path]);
  }
  console.expectClean();
});

test("display preferences: duration unit and theme", async ({ page, context }) => {
  const console = watchConsole(page);
  await loginAs(context, F5.profile);
  await page.goto("/profile#display");
  try {
    const unit = page.getByRole("radiogroup", { name: "Show durations in" });
    await unit.getByRole("radio", { name: "Days" }).click();
    await expect(toastWith(page, "Durations now show in days")).toBeVisible();
    expect((await profileRow()).duration_unit).toBe("days");
    await expect(page.getByText("Example: 1.5 d at 8 hours a day.")).toBeVisible();
    await unit.getByRole("radio", { name: "Hours" }).click();
    await expect(toastWith(page, "Durations now show in hours")).toBeVisible();
    expect((await profileRow()).duration_unit).toBe("hours");
  } finally {
    const { client } = await supabaseAs(F5.profile);
    await client.rpc("update_profile", { p_patch: { duration_unit: "hours" } });
  }

  const theme = page.getByRole("radiogroup", { name: "Theme" });
  await theme.getByRole("radio", { name: "Dark" }).click();
  await expect(page.locator("html")).toHaveClass(/dark/);
  await theme.getByRole("radio", { name: "Light" }).click();
  await expect(page.locator("html")).not.toHaveClass(/dark/);
  await theme.getByRole("radio", { name: "System" }).click();
  console.expectClean();
});

test("notification preferences and the daily email digest", async ({ page, context }) => {
  const console = watchConsole(page);
  await loginAs(context, F5.profile);
  await page.goto("/profile#notifications");
  try {
    const statusEmail = page.getByRole("switch", { name: "Project status changed: email" });
    await expect(statusEmail).not.toBeChecked();
    await statusEmail.click();
    await expect(toastWith(page, "Project status changed: email on")).toBeVisible();
    await expect(statusEmail).toBeChecked();
    let prefs = (await profileRow()).notification_prefs as Record<string, { in_app?: boolean; email?: boolean }>;
    expect(prefs.project_status_changed).toEqual({ in_app: true, email: true });

    const delayedInApp = page.getByRole("switch", { name: "Project delayed: in-app" });
    await delayedInApp.click();
    await expect(toastWith(page, "Project delayed: in-app off")).toBeVisible();

    await page.getByRole("radio", { name: "Daily summary" }).click();
    await expect(toastWith(page, "Emails will arrive as one daily summary")).toBeVisible();
    prefs = (await profileRow()).notification_prefs as Record<string, { in_app?: boolean; email?: boolean }>;
    expect((prefs as unknown as { email_digest: string }).email_digest).toBe("daily");
    expect(prefs.project_delayed).toMatchObject({ in_app: false });

    await page.reload();
    await expect(page.getByRole("switch", { name: "Project status changed: email" })).toBeChecked();
    await expect(page.getByRole("switch", { name: "Project delayed: in-app" })).not.toBeChecked();
    await expect(page.getByRole("radio", { name: "Daily summary" })).toBeChecked();
  } finally {
    const { client } = await supabaseAs(F5.profile);
    await client.rpc("update_notification_prefs", {
      p_prefs: { project_status_changed: { in_app: true, email: false }, project_delayed: { in_app: true, email: true }, email_digest: "off" },
    });
  }
  console.expectClean();
});

test("change the password, then change it back", async ({ page, context }) => {
  const console = watchConsole(page);
  const original = process.env.DEMO_PASSWORD ?? "";
  expect(original.length).toBeGreaterThanOrEqual(10);
  const temporary = `F5-temp-${Date.now()}-pw`;
  await loginAs(context, F5.profile, { fresh: true });
  await page.goto("/profile#password");
  const form = page.getByRole("form", { name: "Change password" });
  const current = form.getByLabel("Current password");
  const next = form.getByLabel("New password", { exact: true });
  const confirm = form.getByLabel("Confirm new password");
  let changed = false;
  try {
    await next.fill("short");
    await next.blur();
    await expect(form.getByText("Use at least 10 characters.")).toBeVisible();

    await current.fill("not-my-password-123");
    await next.fill(temporary);
    await confirm.fill(`${temporary}x`);
    await form.getByRole("button", { name: "Change password" }).click();
    await expect(form.getByText("The passwords don't match.", { exact: false })).toBeVisible();

    await confirm.fill(temporary);
    await form.getByRole("button", { name: "Change password" }).click();
    await expect(form.getByText("That's not your current password.", { exact: false })).toBeVisible();

    await current.fill(original);
    await form.getByRole("button", { name: "Change password" }).click();
    await expect(toastWith(page, "Password changed")).toBeVisible();
    changed = true;
    await expect(current).toHaveValue("");

    // And back, through the same form.
    await current.fill(temporary);
    await next.fill(original);
    await confirm.fill(original);
    await form.getByRole("button", { name: "Change password" }).click();
    await expect(current).toHaveValue("");
    await expect(form.getByRole("alert")).toHaveCount(0);
    expect(await canSignIn(F5.profile.email, original)).toBe(true);
    changed = false;
  } finally {
    if (changed) await restorePassword(F5.profile.email, temporary, original);
  }
  console.expectClean();
});

test("sign out from the profile", async ({ page, context }) => {
  await loginAs(context, F5.profile, { fresh: true });
  await page.goto("/profile#session");
  await page.getByRole("button", { name: "Sign out" }).last().click();
  await expect(page).toHaveURL(/\/login/);
});
