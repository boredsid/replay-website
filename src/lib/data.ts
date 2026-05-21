// src/lib/data.ts
// Build-time supabase reads from Astro frontmatter. RLS gates every
// query — only is_published rows are visible to the anon client.
import { supabase } from './supabase';
import type { EditionRow, SponsorRow, ScheduleItemRow } from './types';

export async function getCurrentEdition(): Promise<EditionRow | null> {
  const { data, error } = await supabase
    .from('editions')
    .select('*')
    .eq('is_current', true)
    .eq('is_published', true)
    .maybeSingle();
  if (error) {
    console.error('getCurrentEdition error:', error);
    return null;
  }
  return (data as EditionRow) ?? null;
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
