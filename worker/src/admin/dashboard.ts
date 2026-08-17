import type { Env } from '../index';
import type { SupabaseClient } from '@supabase/supabase-js';
import { adminJson } from './auth';
import { getEditionBySlug, getCurrentEdition, getReservedSeatsByDay } from '../editions';

export async function handleDashboard(req: Request, env: Env, sb: SupabaseClient, origin: string): Promise<Response> {
  const slug = new URL(req.url).searchParams.get('edition');
  const edition = slug ? await getEditionBySlug(env, slug) : await getCurrentEdition(env);
  if (!edition) return adminJson({ error: 'no_edition' }, 404, origin);

  const seats = await getReservedSeatsByDay(env, edition.id);
  const cap = edition.capacity_per_day;
  const spots_by_day = {
    day1: { capacity: cap.day1, reserved: seats.day1, remaining: Math.max(0, cap.day1 - seats.day1) },
    day2: { capacity: cap.day2, reserved: seats.day2, remaining: Math.max(0, cap.day2 - seats.day2) },
  };

  const allRes = await sb.from('registrations').select('payment_status, amount_paid').eq('edition_id', edition.id);
  if (allRes.error) return adminJson({ error: 'registration_totals_failed' }, 500, origin);
  const all = (allRes.data ?? []) as { payment_status: string; amount_paid: number }[];
  const totals = {
    confirmed: all.filter((r) => r.payment_status === 'confirmed').length,
    pending: all.filter((r) => r.payment_status === 'pending').length,
    cancelled: all.filter((r) => r.payment_status === 'cancelled').length,
    revenue: all.filter((r) => r.payment_status === 'confirmed').reduce((s, r) => s + Number(r.amount_paid || 0), 0),
  };

  const recentRegsRes = await sb
    .from('registrations')
    .select('id, user_phone, pass_type, days, payment_status, amount_paid, created_at')
    .eq('edition_id', edition.id)
    .order('created_at', { ascending: false })
    .limit(10);

  const recentLeadsRes = await sb
    .from('leads')
    .select('*')
    .eq('edition_id', edition.id)
    .order('created_at', { ascending: false })
    .limit(10);
  if (recentRegsRes.error || recentLeadsRes.error) return adminJson({ error: 'recent_activity_failed' }, 500, origin);

  return adminJson(
    {
      edition: { id: edition.id, slug: edition.slug, name: edition.name, registration_status: edition.registration_status },
      spots_by_day,
      totals,
      recent_registrations: recentRegsRes.data ?? [],
      recent_leads: recentLeadsRes.data ?? [],
    },
    200,
    origin,
  );
}
