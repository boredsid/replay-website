// worker/src/editions.ts
import type { Env } from './index';
import { serviceClient } from './supabase';
import type { Day } from './validation';

export interface EditionRow {
  id: string;
  slug: string;
  name: string;
  start_date: string;
  end_date: string;
  venue: string;
  capacity_per_day: { day1: number; day2: number };
  pricing: unknown;
  registration_status: 'upcoming' | 'open' | 'sold_out' | 'closed';
  is_current: boolean;
  is_published: boolean;
}

export async function getEditionById(env: Env, id: string): Promise<EditionRow | null> {
  const sb = serviceClient(env);
  const { data, error } = await sb
    .from('editions')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (error) throw new Error(`editions: ${error.message}`);
  return (data as EditionRow) ?? null;
}

export async function getConfirmedSeatsByDay(env: Env, editionId: string): Promise<{ day1: number; day2: number }> {
  const sb = serviceClient(env);
  const { data, error } = await sb
    .from('registrations')
    .select('days, seats')
    .eq('edition_id', editionId)
    .eq('payment_status', 'confirmed');
  if (error) throw new Error(`registrations: ${error.message}`);
  let day1 = 0;
  let day2 = 0;
  for (const row of (data ?? []) as { days: Day[]; seats: number }[]) {
    if (row.days.includes('day1')) day1 += row.seats;
    if (row.days.includes('day2')) day2 += row.seats;
  }
  return { day1, day2 };
}

const DAY_NAMES: Record<Day, string> = { day1: 'Saturday', day2: 'Sunday' };
export function dayLabel(days: Day[]): string {
  return days.map((d) => DAY_NAMES[d]).join(' + ');
}

export async function getEditionBySlug(env: Env, slug: string): Promise<EditionRow | null> {
  const sb = serviceClient(env);
  const { data, error } = await sb.from('editions').select('*').eq('slug', slug).maybeSingle();
  if (error) throw new Error(`editions: ${error.message}`);
  return (data as EditionRow) ?? null;
}

export async function getCurrentEdition(env: Env): Promise<EditionRow | null> {
  const sb = serviceClient(env);
  const { data, error } = await sb.from('editions').select('*').eq('is_current', true).maybeSingle();
  if (error) throw new Error(`editions: ${error.message}`);
  return (data as EditionRow) ?? null;
}
