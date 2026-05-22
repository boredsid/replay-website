// worker/src/supabase.ts
import { createClient, SupabaseClient } from "@supabase/supabase-js";
import type { Env } from "./index";

export function serviceClient(env: Env): SupabaseClient {
  return createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
