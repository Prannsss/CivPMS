import "server-only";

/**
 * Supabase client for Server Components, Server Actions and Route Handlers. Acts as the signed-in
 * user (publishable key + session cookies), so RLS applies. Create one per request; never share it.
 */
import { createServerClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { publicEnv } from "@/lib/env";
import type { Database } from "./database.types";

export type ServerSupabaseClient = SupabaseClient<Database>;

export async function createClient(): Promise<ServerSupabaseClient> {
  const cookieStore = await cookies();

  return createServerClient<Database>(publicEnv.supabaseUrl, publicEnv.supabasePublishableKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Server Components cannot set cookies. That is fine: src/proxy.ts refreshes the
          // session on every request and writes the cookies there.
        }
      },
    },
  });
}
