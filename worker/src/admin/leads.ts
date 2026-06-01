import type { Env } from '../index';
import type { SupabaseClient } from '@supabase/supabase-js';
import { adminJson } from './auth';
import { getEditionBySlug, getCurrentEdition } from '../editions';

export async function handleLeadsList(req: Request, env: Env, sb: SupabaseClient, origin: string): Promise<Response> {
  const slug = new URL(req.url).searchParams.get('edition');
  const edition = slug ? await getEditionBySlug(env, slug) : await getCurrentEdition(env);
  if (!edition) return adminJson({ error: 'no_edition' }, 404, origin);
  const { data, error } = await sb
    .from('leads')
    .select('*')
    .eq('edition_id', edition.id)
    .order('created_at', { ascending: false });
  if (error) return adminJson({ error: 'query_failed' }, 500, origin);
  return adminJson({ leads: data ?? [] }, 200, origin);
}
