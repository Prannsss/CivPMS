"use server";

/**
 * Profile mutations (spec §2, §14): name, photo, duration display unit and notification
 * preferences. Every write goes through an RPC that only touches the caller's own row. Password
 * changes run in the browser (`supabase.auth.updateUser`) so the password never passes through a
 * Server Action (dev servers log action arguments).
 */
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { failFrom, fromZodError, ok, runAction, type ActionResult } from "@/lib/action-result";
import { EMAIL_DIGEST_OPTIONS } from "@/lib/domain/schemas";
import { NOTIFICATION_TYPES } from "@/lib/notifications";
import type { Json } from "@/lib/supabase/database.types";
import { createClient } from "@/lib/supabase/server";

function revalidateProfile(): void {
  // The name and photo also show in the top bar of every page.
  revalidatePath("/", "layout");
}

const nameSchema = z.object({
  fullName: z
    .string({ error: "Enter your full name." })
    .transform((value) => value.replace(/\s+/g, " ").trim())
    .pipe(
      z
        .string()
        .min(2, "Enter your full name (at least 2 characters).")
        .max(100, "Names can be up to 100 characters. Shorten it a little."),
    ),
});

/** Changes the display name (shown to teammates, in the audit trail and on invitations). */
export async function updateFullName(input: { fullName: string }): Promise<ActionResult<{ fullName: string }>> {
  return runAction(async () => {
    const parsed = nameSchema.safeParse(input);
    if (!parsed.success) return fromZodError(parsed.error);
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("update_profile", { p_patch: { full_name: parsed.data.fullName } });
    if (error) return failFrom(error);
    revalidateProfile();
    return ok({ fullName: data.full_name ?? parsed.data.fullName });
  });
}

const avatarSchema = z.object({
  avatarUrl: z
    .url({ protocol: /^https$/, error: "The photo must be an https:// link. Upload it again." })
    .max(2048, "The photo link is too long. Upload it again.")
    .nullable(),
});

/** Saves an uploaded photo's URL on the profile, or removes the photo (`null`). */
export async function setAvatar(input: { avatarUrl: string | null }): Promise<ActionResult<{ avatarUrl: string | null }>> {
  return runAction(async () => {
    const parsed = avatarSchema.safeParse(input);
    if (!parsed.success) return fromZodError(parsed.error);
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("update_profile", { p_patch: { avatar_url: parsed.data.avatarUrl } });
    if (error) return failFrom(error);
    revalidateProfile();
    return ok({ avatarUrl: data.avatar_url });
  });
}

const unitSchema = z.object({ durationUnit: z.enum(["hours", "days"], { error: "Choose Hours or Days." }) });

/** How durations are displayed (they are always stored in working hours, D20). */
export async function setDurationUnit(input: { durationUnit: "hours" | "days" }): Promise<ActionResult<{ durationUnit: "hours" | "days" }>> {
  return runAction(async () => {
    const parsed = unitSchema.safeParse(input);
    if (!parsed.success) return fromZodError(parsed.error);
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("update_profile", { p_patch: { duration_unit: parsed.data.durationUnit } });
    if (error) return failFrom(error);
    revalidateProfile();
    return ok({ durationUnit: data.duration_unit });
  });
}

const channelSchema = z.object({
  inApp: z.boolean({ error: "Choose on or off for in-app notifications." }),
  email: z.boolean({ error: "Choose on or off for email notifications." }),
});

const prefsSchema = z
  .object({
    types: z.partialRecord(z.enum(NOTIFICATION_TYPES, { error: "Reload the page: this notification type is unknown." }), channelSchema).optional(),
    emailDigest: z.enum(EMAIL_DIGEST_OPTIONS, { error: "Choose off or daily for the email digest." }).optional(),
  })
  .refine((value) => value.emailDigest !== undefined || (value.types && Object.keys(value.types).length > 0), {
    error: "Nothing to save.",
  });

export type NotificationPrefsPatch = z.input<typeof prefsSchema>;

/** Saves in-app/email choices for some notification types and/or the daily digest option. */
export async function updateNotificationPrefs(input: NotificationPrefsPatch): Promise<ActionResult<void>> {
  return runAction(async () => {
    const parsed = prefsSchema.safeParse(input);
    if (!parsed.success) return fromZodError(parsed.error);
    const payload: { [key: string]: Json } = {};
    for (const [type, channels] of Object.entries(parsed.data.types ?? {})) {
      if (channels) payload[type] = { in_app: channels.inApp, email: channels.email };
    }
    if (parsed.data.emailDigest) payload.email_digest = parsed.data.emailDigest;
    const supabase = await createClient();
    const { error } = await supabase.rpc("update_notification_prefs", { p_prefs: payload });
    if (error) return failFrom(error);
    revalidatePath("/profile");
    return ok();
  });
}
