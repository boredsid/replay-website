// src/lib/data.ts
// Build-time supabase reads from Astro frontmatter. RLS gates every
// query — only is_published rows are visible to the anon client.
import { supabase } from './supabase';
import type { EditionRow, SponsorRow, ScheduleItemRow } from './types';

/** "replay-3" → "3rd edition", "replay-21" → "21st edition", etc. */
export function editionOrdinal(slug: string): string {
  const n = parseInt(slug.replace(/^replay-/, ''), 10);
  if (!Number.isFinite(n)) return '';
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  const suffix = s[(v - 20) % 10] || s[v] || s[0];
  return `${n}${suffix} edition`;
}

/** "2026-09-12" → "Sep 12" (no year, no locale weirdness). */
export function shortDate(iso: string): string {
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return iso;
  return `${months[parseInt(m[2], 10) - 1]} ${parseInt(m[3], 10)}`;
}

/** "2026-09-12" + "2026-09-13" → "Sep 12 – Sep 13". */
export function shortDateRange(start: string, end: string): string {
  return `${shortDate(start)} – ${shortDate(end)}`;
}

export async function getCurrentEdition(): Promise<EditionRow | null> {
  const { data, error } = await supabase
    .from('editions')
    .select('*')
    .eq('is_published', true)
    .order('start_date', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(1);
  if (error) {
    console.error('getCurrentEdition error:', error);
    return null;
  }
  const rows = (data as EditionRow[]) ?? [];
  return rows[0] ?? null;
}

export async function getSponsors(editionId: string): Promise<SponsorRow[]> {
  const { data, error } = await supabase
    .from('sponsors')
    .select('*')
    .eq('edition_id', editionId)
    .order('display_order', { ascending: true });
  if (error) {
    console.error('getSponsors error:', error);
    return [];
  }
  return (data as SponsorRow[]) ?? [];
}

export async function getScheduleItems(editionId: string): Promise<ScheduleItemRow[]> {
  const { data, error } = await supabase
    .from('schedule_items')
    .select('*')
    .eq('edition_id', editionId)
    .order('day', { ascending: true })
    .order('start_time', { ascending: true });
  if (error) {
    console.error('getScheduleItems error:', error);
    return [];
  }
  return (data as ScheduleItemRow[]) ?? [];
}
