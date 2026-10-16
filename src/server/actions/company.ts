"use server";

/**
 * Company settings mutations (spec §2.2, §4.4, D11, D13). The RPCs enforce who may do what
 * (Owner PM only, except company-wide invite codes which company PMs may also manage); these
 * actions validate input, map errors to plain language and refresh the affected pages.
 */
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { failFrom, fromZodError, ok, runAction, type ActionResult } from "@/lib/action-result";
import { companyNameSchema } from "@/lib/domain/schemas";
import { createClient } from "@/lib/supabase/server";
import { queueEmailDispatch } from "@/server/email-dispatch";

const SETTINGS_PATH = "/settings";
const userId = z.uuid({ error: "Reload the page and try again." });

/** Renames the company (unique, case- and space-insensitive). */
export async function renameCompany(input: { name: string }): Promise<ActionResult<{ name: string }>> {
  return runAction(async () => {
    const parsed = z.object({ name: companyNameSchema }).safeParse(input);
    if (!parsed.success) return fromZodError(parsed.error);
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("rename_company", { p_name: parsed.data.name });
    if (error) return failFrom(error);
    // The company name shows in the top bar and on the projects home.
    revalidatePath("/", "layout");
    return ok({ name: data.name });
  });
}

const defaultsSchema = z.object({
  workDays: z
    .array(z.number().int().min(1).max(7), { error: "Pick the working days." })
    .min(1, "Pick at least one working day.")
    .max(7)
    .refine((days) => new Set(days).size === days.length, "Each day can only be picked once."),
  hoursPerDay: z.preprocess(
    (value) => (typeof value === "string" ? Number(value.trim()) : value),
    z
      .number({ error: "Enter the working hours per day, from 1 to 24." })
      .min(1, "Enter at least 1 working hour per day.")
      .max(24, "A day has at most 24 hours.")
      .refine((value) => Math.round(value * 100) === value * 100, "Use at most 2 decimals, e.g. 7.5."),
  ),
});

/** Default working days and hours per day for NEW projects (existing calendars don't change). */
export async function updateCompanyDefaults(input: {
  workDays: number[];
  hoursPerDay: number | string;
}): Promise<ActionResult<{ workDays: number[]; hoursPerDay: number }>> {
  return runAction(async () => {
    const parsed = defaultsSchema.safeParse(input);
    if (!parsed.success) return fromZodError(parsed.error);
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("update_company_defaults", {
      p_work_days: parsed.data.workDays,
      p_hours_per_day: parsed.data.hoursPerDay,
    });
    if (error) return failFrom(error);
    revalidatePath(SETTINGS_PATH);
    return ok({ workDays: data.default_work_days, hoursPerDay: Number(data.default_hours_per_day) });
  });
}

/** Promotes an inspector to PM or demotes a PM to inspector (also demotes their project PM roles). */
export async function setMemberRole(input: { userId: string; role: "pm" | "inspector" }): Promise<ActionResult<void>> {
  return runAction(async () => {
    const parsed = z
      .object({ userId, role: z.enum(["pm", "inspector"], { error: "Choose Project Manager or Inspector." }) })
      .safeParse(input);
    if (!parsed.success) return fromZodError(parsed.error);
    const supabase = await createClient();
    const { error } = await supabase.rpc("set_company_member_role", { p_user_id: parsed.data.userId, p_role: parsed.data.role });
    if (error) return failFrom(error);
    revalidatePath(SETTINGS_PATH);
    return ok();
  });
}

/** Removes someone from the company: all project access goes, their history stays attributed. */
export async function removeMember(input: { userId: string }): Promise<ActionResult<void>> {
  return runAction(async () => {
    const parsed = z.object({ userId }).safeParse(input);
    if (!parsed.success) return fromZodError(parsed.error);
    const supabase = await createClient();
    const { error } = await supabase.rpc("remove_company_member", { p_user_id: parsed.data.userId });
    if (error) return failFrom(error);
    queueEmailDispatch();
    revalidatePath(SETTINGS_PATH);
    return ok();
  });
}

const optionalPositiveInt = (max: number, message: string) =>
  z.preprocess(
    (value) => (value === "" || value === null || value === undefined ? null : Number(value)),
    z.number({ error: message }).int(message).min(1, message).max(max, message).nullable(),
  );

const createCodeSchema = z.object({
  expiresInDays: optionalPositiveInt(365, "Choose an expiry between 1 and 365 days, or no expiry."),
  maxUses: optionalPositiveInt(1000, "Enter a usage limit between 1 and 1,000, or leave it empty for no limit."),
});

/** Creates a company-wide invite code for inspectors (D11). */
export async function createCompanyInviteCode(input: {
  expiresInDays: number | null;
  maxUses: number | string | null;
}): Promise<ActionResult<{ id: string; code: string }>> {
  return runAction(async () => {
    const parsed = createCodeSchema.safeParse(input);
    if (!parsed.success) return fromZodError(parsed.error);
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("create_invite_code", {
      p_expires_in_days: parsed.data.expiresInDays ?? undefined,
      p_max_uses: parsed.data.maxUses ?? undefined,
    });
    if (error) return failFrom(error);
    revalidatePath(SETTINGS_PATH);
    return ok({ id: data.id, code: data.code });
  });
}

/** Turns a code off; people who already joined keep their access. */
export async function revokeCompanyInviteCode(input: { codeId: string }): Promise<ActionResult<void>> {
  return runAction(async () => {
    const parsed = z.object({ codeId: z.uuid({ error: "Reload the page and try again." }) }).safeParse(input);
    if (!parsed.success) return fromZodError(parsed.error);
    const supabase = await createClient();
    const { error } = await supabase.rpc("revoke_invite_code", { p_id: parsed.data.codeId });
    if (error) return failFrom(error);
    revalidatePath(SETTINGS_PATH);
    return ok();
  });
}
