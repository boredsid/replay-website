import type { Env } from '../index';
import type { SupabaseClient } from '@supabase/supabase-js';
import { adminJson } from './auth';
import { writeAudit } from './audit';

export async function handleRebuild(env: Env, sb: SupabaseClient, email: string, origin: string): Promise<Response> {
  const res = await fetch(env.CLOUDFLARE_PAGES_DEPLOY_HOOK, { method: 'POST' });
  if (!res.ok) return adminJson({ error: 'deploy_hook_failed' }, 502, origin);
  await writeAudit(sb, { actor_email: email, action: 'site.rebuild', target_table: 'site', target_id: null, diff: null });
  return adminJson({ ok: true }, 200, origin);
}
