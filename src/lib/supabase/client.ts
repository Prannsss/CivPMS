/**
 * Supabase client for Client Components (browser). One instance per tab: the session lives in
 * cookies shared with the server, so the browser and RSC renders see the same user.
 */
import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { publicEnv } from "@/lib/env";
import type { Database } from "./database.types";

export type BrowserSupabaseClient = SupabaseClient<Database>;

let browserClient: BrowserSupabaseClient | undefined;

export function createClient(): BrowserSupabaseClient {
  browserClient ??= createBrowserClient<Database>(publicEnv.supabaseUrl, publicEnv.supabasePublishableKey);
  return browserClient;
}
