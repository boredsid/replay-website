// src/lib/supabase.ts
// Browser-safe anon client. RLS gates every public read. Service-role
// access goes through worker/src/supabase.ts, not here.
import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.PUBLIC_SUPABASE_URL ?? 'https://placeholder.supabase.co';
const anon = import.meta.env.PUBLIC_SUPABASE_ANON_KEY ?? 'placeholder';

export const supabase = createClient(url, anon, {
  auth: { persistSession: false, autoRefreshToken: false },
});
