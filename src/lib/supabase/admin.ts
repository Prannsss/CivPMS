import "server-only";

/**
 * Secret-key Supabase client. It bypasses RLS, so it is only for trusted server jobs (email
 * outbox, daily checks), never for user-facing reads (CLAUDE.md data-access rule 1), and never
 * imported by client code (`server-only` makes that a build error).
 *
 * Returns `null` when SUPABASE_SECRET_KEY is not configured; callers degrade gracefully.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { publicEnv, serverEnv, warnOnce } from "@/lib/env";
import type { Database } from "./database.types";

export type AdminSupabaseClient = SupabaseClient<Database>;

let adminClient: AdminSupabaseClient | undefined;
let adminKey: string | undefined;

export function createAdminClient(): AdminSupabaseClient | null {
  const { supabaseSecretKey } = serverEnv();
  if (!supabaseSecretKey) {
    warnOnce(
      "admin:no-secret-key",
      "SUPABASE_SECRET_KEY is not set: background jobs (notification emails, daily checks) are disabled.",
    );
    return null;
  }
  if (!adminClient || adminKey !== supabaseSecretKey) {
    adminKey = supabaseSecretKey;
    adminClient = createClient<Database>(publicEnv.supabaseUrl, supabaseSecretKey, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      global: { headers: { "X-Client-Info": "civpms-admin" } },
    });
  }
  return adminClient;
}
