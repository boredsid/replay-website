// src/lib/data.ts
// Build-time supabase reads from Astro frontmatter. RLS gates every
// query — only is_published rows are visible to the anon client.
import { supabase } from './supabase';
import type { EditionPricing, EditionRow, SponsorRow, ScheduleItemRow } from './types';
import { readPartnerPricing } from './partner-packages';

export function readEditionPricing(input: unknown): EditionPricing {
  if (!input || typeof input !== 'object') throw new Error('edition pricing is not an object');
  const pricing = input as Record<string, unknown>;
  let oneshot: number;
  if (typeof pricing.oneshot === 'number') {
    oneshot = pricing.oneshot;
  } else if (pricing.oneshot && typeof pricing.oneshot === 'object' && !Array.isArray(pricing.oneshot)) {
    const legacy = pricing.oneshot as Record<string, unknown>;
    const values = Object.values(legacy);
    if (typeof legacy.day1 !== 'number' || values.some((value) => value !== legacy.day1)) {
      throw new Error('legacy edition day prices are not identical');
    }
    oneshot = legacy.day1;
  } else {
    throw new Error('edition one-day price is invalid');
  }
  if (typeof pricing.campaign !== 'number') throw new Error('edition two-day price is invalid');
  if (oneshot < 0 || pricing.campaign < 0) throw new Error('edition prices must be non-negative');
  if (pricing.adventurer_cap !== undefined && (typeof pricing.adventurer_cap !== 'number' || pricing.adventurer_cap < 0)) {
    throw new Error('edition adventurer cap is invalid');
  }
  return {
    oneshot,
    campaign: pricing.campaign,
    ...(pricing.adventurer_cap === undefined ? {} : { adventurer_cap: pricing.adventurer_cap }),
  };
}

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

/** "2026-09-12" + "2026-09-13" → "Sep 12–13, 2026". */
export function publicDateRange(start: string, end: string): string {
  const first = start.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const last = end.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!first || !last) return `${start} – ${end}`;
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const startYear = Number(first[1]);
  const startMonth = Number(first[2]);
  const startDay = Number(first[3]);
  const endYear = Number(last[1]);
  const endMonth = Number(last[2]);
  const endDay = Number(last[3]);
  if (!months[startMonth - 1] || !months[endMonth - 1] || startDay < 1 || endDay < 1) return `${start} – ${end}`;
  if (startYear === endYear && startMonth === endMonth) {
    return `${months[startMonth - 1]} ${startDay}–${endDay}, ${endYear}`;
  }
  if (startYear === endYear) {
    return `${months[startMonth - 1]} ${startDay}–${months[endMonth - 1]} ${endDay}, ${endYear}`;
  }
  return `${months[startMonth - 1]} ${startDay}, ${startYear}–${months[endMonth - 1]} ${endDay}, ${endYear}`;
}

export async function getCurrentEdition(): Promise<EditionRow | null> {
  const { data, error } = await supabase
    .from('editions')
    .select('*')
    .eq('is_current', true)
    .eq('is_published', true)
    .maybeSingle();
  if (error) throw new Error(`getCurrentEdition failed: ${error.message}`);
  if (!data) return null;
  const row = data as Omit<EditionRow, 'pricing' | 'partner_pricing'> & { pricing: unknown; partner_pricing?: unknown };
  return {
    ...row,
    pricing: readEditionPricing(row.pricing),
    partner_pricing: readPartnerPricing(row.partner_pricing),
  };
}

export async function getSponsors(editionId: string): Promise<SponsorRow[]> {
  const { data, error } = await supabase
    .from('sponsors')
    .select('*')
    .eq('edition_id', editionId)
    .order('display_order', { ascending: true });
  if (error) throw new Error(`getSponsors failed: ${error.message}`);
  return (data as SponsorRow[]) ?? [];
}

export async function getScheduleItems(editionId: string): Promise<ScheduleItemRow[]> {
  const { data, error } = await supabase
    .from('schedule_items')
    .select('*')
    .eq('edition_id', editionId)
    .order('day', { ascending: true })
    .order('start_time', { ascending: true });
  if (error) throw new Error(`getScheduleItems failed: ${error.message}`);
  const sectionOrder = ['always-on', 'programme', 'playtesting', 'publisher-showcase', 'event-floor'];
  return ((data ?? []) as Array<Partial<ScheduleItemRow> & Pick<ScheduleItemRow, 'id' | 'edition_id' | 'day' | 'title' | 'kind'>>).map((item) => ({
    ...item,
    start_time: item.start_time ?? null,
    end_time: item.end_time ?? null,
    description: item.description ?? null,
    location: item.location ?? null,
    section: item.section ?? 'programme',
    is_all_day: item.is_all_day ?? false,
    host_name: item.host_name ?? null,
    signup_mode: item.signup_mode ?? 'none',
    signup_url: item.signup_url ?? null,
    public_status: item.public_status ?? 'published',
    display_order: item.display_order ?? 0,
  })).sort((a, b) =>
    a.day.localeCompare(b.day)
    || sectionOrder.indexOf(a.section) - sectionOrder.indexOf(b.section)
    || a.display_order - b.display_order
    || (a.start_time ?? '').localeCompare(b.start_time ?? '')
  );
}
