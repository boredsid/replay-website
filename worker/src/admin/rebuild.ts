import type { Env } from '../index';
import type { SupabaseClient } from '@supabase/supabase-js';
import { adminJson } from './auth';
import { writeAudit } from './audit';

/**
 * Asks Cloudflare Pages to rebuild the public site from `main`.
 *
 * The one place the deploy hook is posted to — the console's Rebuild button
 * and the nightly phase check both come through here. The hook URL is a
 * credential and never leaves the Worker.
 */
export async function fireDeployHook(env: Env): Promise<boolean> {
  const res = await fetch(env.CLOUDFLARE_PAGES_DEPLOY_HOOK, { method: 'POST' });
  return res.ok;
}

export async function handleRebuild(env: Env, sb: SupabaseClient, email: string, origin: string): Promise<Response> {
  if (!(await fireDeployHook(env))) return adminJson({ error: 'deploy_hook_failed' }, 502, origin);
  await writeAudit(sb, { actor_email: email, action: 'site.rebuild', target_table: 'site', target_id: null, diff: null });
  return adminJson({ ok: true }, 200, origin);
}
