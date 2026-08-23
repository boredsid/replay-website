import type { Env } from '../index';
import type { SupabaseClient } from '@supabase/supabase-js';
import { adminJson } from './auth';
import { getEditionBySlug } from '../editions';

export async function handleLeadsList(req: Request, env: Env, sb: SupabaseClient, origin: string): Promise<Response> {
  const params = new URL(req.url).searchParams;
  const editionFilter = params.get('edition') || 'all';
  const conversionFilter = params.get('conversion') || 'active';
  if (!['active', 'converted', 'all'].includes(conversionFilter)) {
    return adminJson({ error: 'invalid_conversion_filter' }, 400, origin);
  }

  let editionId: string | null = null;
  if (editionFilter !== 'all' && editionFilter !== 'untagged') {
    const edition = await getEditionBySlug(env, editionFilter);
    if (!edition) return adminJson({ error: 'no_edition' }, 404, origin);
    editionId = edition.id;
  }

  let query = sb
    .from('leads')
    .select('*, editions(slug, name, start_date)');

  if (editionFilter === 'untagged') query = query.is('edition_id', null);
  else if (editionId) query = query.eq('edition_id', editionId);

  if (conversionFilter === 'active') query = query.is('converted_at', null);
  else if (conversionFilter === 'converted') query = query.not('converted_at', 'is', null);

  const result = await query.order('created_at', { ascending: false });
  if (result.error) return adminJson({ error: 'query_failed' }, 500, origin);

  return adminJson({ leads: result.data ?? [] }, 200, origin);
}
