import "server-only";

/**
 * Profile page reads (spec §2, §14), as the signed-in user: profile row, company membership,
 * how they sign in (email/password and/or Google) and their notification preferences resolved
 * against `notification_catalog()`.
 */
import { cache } from "react";
import { resolvePrefs, type CatalogEntry, type ResolvedPrefs } from "@/components/profile/notification-prefs";
import type { CompanyRole } from "@/lib/domain";
import { AppException, toAppError } from "@/lib/errors";
import { createClient } from "@/lib/supabase/server";
import { requireOnboarded } from "@/server/context";

export interface ProfilePageData {
  userId: string;
  fullName: string;
  email: string;
  avatarUrl: string | null;
  durationUnit: "hours" | "days";
  /** The role picked during onboarding (pm | inspector), shown when there is no company. */
  rolePref: string | null;
  company: { name: string; role: CompanyRole } | null;
  /** Signs in with Google (the email is managed there). */
  hasGoogle: boolean;
  /** Has an email/password identity (can change the password with the current one). */
  hasPassword: boolean;
  memberSince: string;
  prefs: ResolvedPrefs;
}

function throwReadFailure(error: unknown): never {
  const appError = toAppError(error);
  throw new AppException(appError.code, appError.message, { cause: error });
}

export const getProfilePageData = cache(async (): Promise<ProfilePageData> => {
  const context = await requireOnboarded();
  const supabase = await createClient();
  const [userResult, catalogResult] = await Promise.all([supabase.auth.getUser(), supabase.rpc("notification_catalog")]);
  if (catalogResult.error) throwReadFailure(catalogResult.error);

  const identities = userResult.data.user?.identities ?? [];
  const providers = new Set<string>(identities.map((identity) => identity.provider));
  const appProviders = userResult.data.user?.app_metadata?.providers;
  if (Array.isArray(appProviders)) for (const p of appProviders) if (typeof p === "string") providers.add(p);
  if (providers.size === 0) providers.add("email");

  const catalog: CatalogEntry[] = (catalogResult.data ?? []).map((row) => ({
    type: row.type,
    label: row.label,
    description: row.description,
    inAppDefault: row.in_app_default,
    emailDefault: row.email_default,
  }));

  const { profile, membership } = context;
  return {
    userId: context.user.id,
    fullName: profile.full_name?.trim() || "",
    email: profile.email ?? context.user.email ?? "",
    avatarUrl: profile.avatar_url,
    durationUnit: profile.duration_unit,
    rolePref: profile.role_pref,
    company: membership ? { name: membership.companyName, role: membership.role } : null,
    hasGoogle: providers.has("google"),
    hasPassword: providers.has("email"),
    memberSince: profile.created_at,
    prefs: resolvePrefs(profile.notification_prefs, catalog),
  };
});
