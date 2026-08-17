import type { Env } from '../index';
import type { SupabaseClient } from '@supabase/supabase-js';
import { adminJson } from './auth';

export interface AuditEntry {
  actor_email: string;
  action: string;
  target_table: string;
  target_id: string | null;
  diff: unknown;
}

export function diffRows(before: Record<string, unknown>, after: Record<string, unknown>): Record<string, { old: unknown; new: unknown }> {
  const out: Record<string, { old: unknown; new: unknown }> = {};
  for (const key of Object.keys(after)) {
    if (JSON.stringify(before[key]) !== JSON.stringify(after[key])) {
      out[key] = { old: before[key], new: after[key] };
    }
  }
  return out;
}

export async function writeAudit(sb: SupabaseClient, entry: AuditEntry): Promise<void> {
  const { error } = await sb.from('admin_audit_log').insert(entry);
  if (error) throw new Error(`audit_write_failed: ${error.message}`);
}

export async function handleAuditList(req: Request, env: Env, sb: SupabaseClient, origin: string): Promise<Response> {
  const limit = Math.min(200, Number(new URL(req.url).searchParams.get('limit')) || 100);
  const { data, error } = await sb
    .from('admin_audit_log')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) return adminJson({ error: 'query_failed' }, 500, origin);
  return adminJson({ entries: data ?? [] }, 200, origin);
}
