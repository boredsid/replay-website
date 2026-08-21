// worker/src/editions.ts
import type { Env } from './index';
import { serviceClient } from './supabase';
import type { Day } from './validation';

export interface EditionVisitDetails {
  venue_address?: string | null;
  google_maps_url?: string | null;
  entrance_details?: string | null;
  check_in_location?: string | null;
  nearest_metro_name?: string | null;
  nearest_metro_distance?: string | null;
  nearest_bus_stop_name?: string | null;
  nearest_bus_stop_distance?: string | null;
  parking_availability?: string | null;
  parking_charges?: string | null;
  food_details?: string | null;
  water_details?: string | null;
  game_library_process?: string | null;
  help_on_the_day?: string | null;
}

export interface EditionRow extends EditionVisitDetails {
  id: string;
  slug: string;
  name: string;
  start_date: string;
  end_date: string;
  daily_start_time: string;
  daily_end_time: string;
  venue: string;
  capacity_per_day: { day1: number; day2: number };
  pricing: unknown;
  partner_pricing?: unknown;
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

async function getSeatsByDay(
  env: Env,
  editionId: string,
  statuses: Array<'pending' | 'confirmed'>,
): Promise<{ day1: number; day2: number }> {
  const sb = serviceClient(env);
  const { data, error } = await sb
    .from('registrations')
    .select('days, seats')
    .eq('edition_id', editionId)
    .in('payment_status', statuses);
  if (error) throw new Error(`registrations: ${error.message}`);
  let day1 = 0;
  let day2 = 0;
  for (const row of (data ?? []) as { days: Day[]; seats: number }[]) {
    if (row.days.includes('day1')) day1 += row.seats;
    if (row.days.includes('day2')) day2 += row.seats;
  }
  return { day1, day2 };
}

export function getReservedSeatsByDay(env: Env, editionId: string): Promise<{ day1: number; day2: number }> {
  return getSeatsByDay(env, editionId, ['pending', 'confirmed']);
}

export function getConfirmedSeatsByDay(env: Env, editionId: string): Promise<{ day1: number; day2: number }> {
  return getSeatsByDay(env, editionId, ['confirmed']);
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
  const { data, error } = await sb
    .from('editions')
    .select('*')
    .eq('is_current', true)
    .eq('is_published', true)
    .maybeSingle();
  if (error) throw new Error(`editions: ${error.message}`);
  return (data as EditionRow) ?? null;
}
