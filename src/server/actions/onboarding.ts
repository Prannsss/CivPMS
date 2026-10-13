"use server";

/**
 * Onboarding (spec §4.1–4.3, D10–D14): name + role, then either a new company (PM, becomes Owner
 * PM) or joining one (inspector: invite code or email invitation, via
 * src/server/actions/invitations-incoming.ts), or "No company yet".
 */
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { fail, failFrom, failWith, fromZodError, ok, runAction, type ActionResult } from "@/lib/action-result";
import { companyCreateSchema, onboardingProfileSchema } from "@/lib/domain/schemas";
import { toAppError, unexpectedError } from "@/lib/errors";
import { createClient } from "@/lib/supabase/server";

/** RPC `hint` field names → the form's field names. */
const FIELD_NAMES: Record<string, string> = { full_name: "fullName", role_pref: "role", name: "name" };

function failFromRpc(error: unknown) {
  const appError = toAppError(error);
  if (appError.field) {
    const field = FIELD_NAMES[appError.field] ?? appError.field;
    return fail(appError.code, appError.message, { [field]: appError.message });
  }
  return failFrom(error);
}

export interface SavedProfile {
  fullName: string;
  role: "pm" | "inspector";
}

/** Steps 1–2: saves the name and role (does not finish onboarding). */
export async function saveOnboardingProfile(
  input: z.input<typeof onboardingProfileSchema>,
): Promise<ActionResult<SavedProfile>> {
  return runAction(async () => {
    const parsed = onboardingProfileSchema.safeParse(input);
    if (!parsed.success) return fromZodError(parsed.error);

    const supabase = await createClient();
    const { data, error } = await supabase.rpc("complete_profile", {
      p_full_name: parsed.data.fullName,
      p_role_pref: parsed.data.role,
    });
    if (error) return failFromRpc(error);
    return ok({ fullName: data?.full_name ?? parsed.data.fullName, role: parsed.data.role });
  });
}

export interface CompanyNameCheck {
  /** The name as it will be saved (trimmed, single spaces). */
  name: string;
  available: boolean;
}

/** Live availability check for the company-name field (case- and space-insensitive). */
export async function checkCompanyName(input: z.input<typeof companyCreateSchema>): Promise<ActionResult<CompanyNameCheck>> {
  return runAction(async () => {
    const parsed = companyCreateSchema.safeParse(input);
    if (!parsed.success) return fromZodError(parsed.error);

    const supabase = await createClient();
    const { data, error } = await supabase.rpc("company_name_available", { p_name: parsed.data.name });
    if (error) return failFromRpc(error);
    return ok({ name: parsed.data.name, available: data === true });
  });
}

export interface CreatedCompany {
  companyId: string;
  companyName: string;
}

/** Step 3 (PM): creates the company; the caller becomes its Owner PM and onboarding is done. */
export async function createCompany(input: z.input<typeof companyCreateSchema>): Promise<ActionResult<CreatedCompany>> {
  return runAction(async () => {
    const parsed = companyCreateSchema.safeParse(input);
    if (!parsed.success) return fromZodError(parsed.error);

    const supabase = await createClient();
    const { data, error } = await supabase.rpc("create_company", { p_name: parsed.data.name });
    if (error) return failFromRpc(error);
    if (!data?.id) return failWith(unexpectedError(new Error("create_company returned no row")));

    revalidatePath("/", "layout");
    return ok({ companyId: data.id, companyName: data.name });
  });
}

/** Step 3 (inspector without a code): finish in "No company yet" (D12). */
export async function finishOnboardingWithoutCompany(): Promise<ActionResult<void>> {
  return runAction(async () => {
    const supabase = await createClient();
    const { error } = await supabase.rpc("finish_onboarding_without_company");
    if (error) return failFromRpc(error);
    revalidatePath("/", "layout");
    return ok();
  });
}
