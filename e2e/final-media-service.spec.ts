/**
 * Profile photo through the civpms-media service (backend/), and the browser fallback when the
 * service is down. Opt-in: it needs a running media service, a dev server built with
 * NEXT_PUBLIC_MEDIA_API_URL pointing at it, and a QA account from supabase/seed/qa-e2e.sql that
 * has finished onboarding (the golden path does that).
 *
 *   # service up: the upload must go through the service
 *   QA_STAMP=… QA_MEDIA_URL=http://localhost:8090 QA_MEDIA_EXPECT=service \
 *     BASE_URL=http://localhost:3211 npx playwright test e2e/final-media-service.spec.ts
 *   # service stopped: the browser resizes and uploads to Supabase Storage itself
 *   QA_STAMP=… QA_MEDIA_URL=http://localhost:8090 QA_MEDIA_EXPECT=fallback \
 *     BASE_URL=http://localhost:3211 npx playwright test e2e/final-media-service.spec.ts
 *
 * The service's APP_ORIGINS must contain the dev server's origin (CORS).
 */
import { expect, test } from "@playwright/test";
import sharp from "sharp";
import { loginAs, supabaseAs, type Who } from "./helpers/auth";
import { watchConsole } from "./helpers/f3-console";
import { toastWith } from "./helpers/ui";

const STAMP = process.env.QA_STAMP ?? "";
const MEDIA_URL = (process.env.QA_MEDIA_URL ?? "").replace(/\/+$/, "");
const EXPECT = process.env.QA_MEDIA_EXPECT === "fallback" ? "fallback" : "service";
test.skip(!/^\d{10,14}$/.test(STAMP) || !MEDIA_URL, "Set QA_STAMP and QA_MEDIA_URL (see the header of this file)");

const WHO: Who = { email: `qa-${STAMP}-pm@civpms.test` };

test(`avatar upload goes through the ${EXPECT === "service" ? "media service" : "browser fallback"}`, async ({ page, context }) => {
  const console = watchConsole(page);
  const { client, userId } = await supabaseAs(WHO);
  const before = await client.from("profiles").select("avatar_url").eq("id", userId).single();
  expect(before.error).toBeNull();

  const mediaCalls: { status: number | null; failed: string | null }[] = [];
  page.on("requestfinished", async (request) => {
    if (request.url() === `${MEDIA_URL}/v1/media/avatar` && request.method() === "POST") {
      mediaCalls.push({ status: (await request.response())?.status() ?? null, failed: null });
    }
  });
  page.on("requestfailed", (request) => {
    if (request.url() === `${MEDIA_URL}/v1/media/avatar` && request.method() === "POST") {
      mediaCalls.push({ status: null, failed: request.failure()?.errorText ?? "failed" });
    }
  });
  const storageUploads: string[] = [];
  page.on("request", (request) => {
    if (request.method() === "POST" && /\/storage\/v1\/object\/avatars\//.test(request.url())) storageUploads.push(request.url());
  });

  // A 1200×800 landscape JPEG: the stored photo must come back as a 256×256 square WebP.
  const jpeg = await sharp({ create: { width: 1200, height: 800, channels: 3, background: { r: 8, g: 102, b: 255 } } })
    .jpeg({ quality: 85 })
    .toBuffer();

  await loginAs(context, WHO);
  await page.goto("/profile");
  await expect(page.getByRole("heading", { level: 1, name: "Profile" })).toBeVisible();
  await page.getByTestId("avatar-file-input").setInputFiles({ name: "qa-site-photo.jpg", mimeType: "image/jpeg", buffer: jpeg });
  await expect(toastWith(page, /Photo (added|updated)/)).toBeVisible({ timeout: 60_000 });

  const after = await client.from("profiles").select("avatar_url").eq("id", userId).single();
  const url = after.data?.avatar_url ?? "";
  expect(url).toMatch(new RegExp(`/storage/v1/object/public/avatars/${userId}/[^/]+\\.webp$`));
  await expect(page.getByRole("button", { name: "Change profile photo" }).locator("img")).toHaveAttribute("src", url);

  const stored = await page.request.get(url);
  expect(stored.status()).toBe(200);
  expect(stored.headers()["content-type"]).toContain("image/webp");
  const meta = await sharp(await stored.body()).metadata();
  expect([meta.format, meta.width, meta.height]).toEqual(["webp", 256, 256]);

  expect(mediaCalls.length).toBe(1);
  if (EXPECT === "service") {
    expect(mediaCalls[0].status).toBe(201);
    expect(storageUploads, "the browser must not upload to Storage itself").toEqual([]);
    console.expectClean();
  } else {
    expect(mediaCalls[0].failed).not.toBeNull();
    expect(storageUploads.length).toBe(1);
    // Chromium itself logs the refused connection; nothing else may appear.
    const others = console.messages.filter((m) => !(/ERR_CONNECTION_REFUSED|Failed to fetch/.test(m)));
    expect(others, others.join("\n")).toEqual([]);
  }
  test.info().annotations.push({ type: "avatar", description: url });
});
