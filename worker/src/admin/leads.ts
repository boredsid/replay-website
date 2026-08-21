import type { Env } from '../index';
import type { SupabaseClient } from '@supabase/supabase-js';
import { adminJson } from './auth';
import { getEditionBySlug, getCurrentEdition } from '../editions';

export async function handleLeadsList(req: Request, env: Env, sb: SupabaseClient, origin: string): Promise<Response> {
  const slug = new URL(req.url).searchParams.get('edition');
  const edition = slug ? await getEditionBySlug(env, slug) : await getCurrentEdition(env);
  if (!edition) return adminJson({ error: 'no_edition' }, 404, origin);
  const [leadsResult, registrationsResult] = await Promise.all([
    sb
      .from('leads')
      .select('*')
      .eq('edition_id', edition.id)
      .order('created_at', { ascending: false }),
    sb
      .from('registrations')
      .select('user_phone')
      .eq('edition_id', edition.id),
  ]);

  if (leadsResult.error || registrationsResult.error) {
    return adminJson({ error: 'query_failed' }, 500, origin);
  }

  const registeredPhones = new Set(
    (registrationsResult.data ?? []).map((registration) => registration.user_phone),
  );
  const leads = (leadsResult.data ?? []).filter((lead) => !registeredPhones.has(lead.phone));

  return adminJson({ leads }, 200, origin);
}
