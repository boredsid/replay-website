// The venue projector's feed: replaycon.in/floor-display polls this.
//
// Public, because the programme, the notices and the counts on it are all
// things anybody at the venue can already see. The one private thing — the
// first names behind "<Name> is in da house!" — is only included when the
// caller presents DISPLAY_KEY, so a stranger polling the endpoint cannot
// watch who walks through the door. With no DISPLAY_KEY configured, names are
// never sent at all; the display then simply skips the arrival banners.
//
// Every count is derived from the rows that already exist (check-in events,
// loans, session signups). Nothing here writes, and nothing is counted in a
// column that could drift.
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Env } from './index';
import { CORS_HEADERS } from './validation';
import { serviceClient } from './supabase';

const IST_OFFSET_MS = 330 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;
/** How far back a first check-in still counts as a fresh arrival. */
export const ARRIVAL_WINDOW_MS = 10 * 60 * 1000;
const MAX_ARRIVALS = 40;
const ROW_LIMIT = 10000;

type DayKey = 'day1' | 'day2';

export interface CheckInRow {
  id: string;
  attendee_id: string;
  day: string;
  kind: string;
  voids_event_id: string | null;
  occurred_at: string;
}

export interface WindowCounts {
  last_1h: number;
  last_2h: number;
  last_3h: number;
  today: number;
  total: number;
}

/** The calendar date in Bengaluru, as YYYY-MM-DD. */
export function istDate(now: Date): string {
  return new Date(now.getTime() + IST_OFFSET_MS).toISOString().slice(0, 10);
}

/** The instant the current Bengaluru day began. */
export function istMidnight(now: Date): number {
  return Date.parse(`${istDate(now)}T00:00:00+05:30`);
}

export function dayKeyFor(edition: { start_date: string; end_date: string }, now: Date): DayKey | null {
  const today = istDate(now);
  if (today === edition.start_date) return 'day1';
  if (today === edition.end_date) return 'day2';
  return null;
}

/** Bucket timestamps into the windows the display phrases its stats from. */
export function countWindows(timestamps: Array<string | null>, now: Date): WindowCounts {
  const t = now.getTime();
  const midnight = istMidnight(now);
  const counts: WindowCounts = { last_1h: 0, last_2h: 0, last_3h: 0, today: 0, total: 0 };
  for (const stamp of timestamps) {
    if (!stamp) continue;
    const at = Date.parse(stamp);
    if (Number.isNaN(at) || at > t) continue;
    counts.total += 1;
    if (at >= midnight) counts.today += 1;
    if (t - at <= 3 * HOUR_MS) counts.last_3h += 1;
    if (t - at <= 2 * HOUR_MS) counts.last_2h += 1;
    if (t - at <= HOUR_MS) counts.last_1h += 1;
  }
  return counts;
}

/**
 * Each attendee's first valid check-in per day.
 *
 * Voided rows, and the rows that void them, are dropped first — an undo at the
 * desk must not leave a phantom arrival. Re-entry after lunch is a second "in"
 * on the same day and is deliberately not a new arrival: the projector greets
 * people once a day, not every time they step out for air.
 */
export function firstArrivals(events: CheckInRow[]): Array<{ id: string; attendee_id: string; day: string; occurred_at: string }> {
  const voided = new Set(events.map((e) => e.voids_event_id).filter((id): id is string => Boolean(id)));
  const first = new Map<string, CheckInRow>();
  for (const event of events) {
    if (event.kind !== 'in' || event.voids_event_id || voided.has(event.id)) continue;
    const key = `${event.attendee_id}:${event.day}`;
    const current = first.get(key);
    if (!current || Date.parse(event.occurred_at) < Date.parse(current.occurred_at)) first.set(key, event);
  }
  return [...first.values()].map(({ id, attendee_id, day, occurred_at }) => ({ id, attendee_id, day, occurred_at }));
}

/** "Priya Raman" → "Priya". Guests the desk never named have no banner. */
export function firstName(displayName: string | null | undefined): string | null {
  const first = displayName?.trim().split(/\s+/)[0];
  if (!first) return null;
  return first.length > 24 ? first.slice(0, 24) : first;
}

/** Most-borrowed title today, so the display can crown one. Ties go to the title seen first. */
export function topTitle(titles: Array<string | null>): { title: string; count: number } | null {
  const counts = new Map<string, number>();
  for (const title of titles) {
    if (!title) continue;
    counts.set(title, (counts.get(title) ?? 0) + 1);
  }
  let best: { title: string; count: number } | null = null;
  for (const [title, count] of counts) {
    if (!best || count > best.count) best = { title, count };
  }
  return best;
}

function keyMatches(presented: string, expected: string): boolean {
  if (!expected || presented.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i += 1) diff |= presented.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}

export function displayKeyPresented(req: Request, expected: string | undefined): boolean {
  if (!expected) return false;
  const header = req.headers.get('Authorization') ?? '';
  const presented = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  return keyMatches(presented, expected);
}

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      // A projector polling every few seconds wants the truth, not a cache.
      'Cache-Control': 'no-store',
      ...CORS_HEADERS,
    },
  });
}

function titleOf(row: any): string | null {
  const copy = Array.isArray(row.library_copies) ? row.library_copies[0] : row.library_copies;
  const title = Array.isArray(copy?.library_titles) ? copy.library_titles[0] : copy?.library_titles;
  return typeof title?.title === 'string' ? title.title : null;
}

export async function buildDisplayFeed(sb: SupabaseClient, now: Date, withNames: boolean): Promise<Response> {
  const editionResult = await sb
    .from('editions')
    .select('id, slug, name, start_date, end_date, daily_start_time, daily_end_time')
    .eq('is_current', true)
    .eq('is_published', true)
    .maybeSingle();

  if (editionResult.error) {
    console.error('display_feed_edition_failed', editionResult.error);
    return response({ error: 'event_unavailable' }, 503);
  }

  const base = { generated_at: now.toISOString(), timezone: 'Asia/Kolkata', names_enabled: withNames };
  if (!editionResult.data) {
    return response({ ...base, edition: null, schedule: [], announcements: [], arrivals: [], stats: null });
  }

  const edition = editionResult.data as any;
  const dayKey = dayKeyFor(edition, now);
  const nowIso = now.toISOString();

  const [schedule, notices, checkIns, loans, signups] = await Promise.all([
    sb.from('schedule_items')
      .select('id, day, start_time, end_time, title, location, kind, section, is_all_day, host_name, public_status, display_order')
      .eq('edition_id', edition.id)
      .in('public_status', ['published', 'cancelled'])
      .order('day', { ascending: true })
      .order('start_time', { ascending: true })
      .limit(500),
    sb.from('announcements')
      .select('id, title, body, severity, audience, starts_at, ends_at, updated_at')
      .eq('edition_id', edition.id)
      .eq('is_published', true)
      .lte('starts_at', nowIso)
      .or(`ends_at.is.null,ends_at.gt.${nowIso}`)
      .order('starts_at', { ascending: false })
      .limit(50),
    sb.from('check_in_events')
      .select('id, attendee_id, day, kind, voids_event_id, occurred_at')
      .eq('edition_id', edition.id)
      .limit(ROW_LIMIT),
    sb.from('library_loans')
      .select('checked_out_at, status, library_copies(library_titles(title))')
      .eq('edition_id', edition.id)
      .not('checked_out_at', 'is', null)
      .limit(ROW_LIMIT),
    sb.from('session_signups')
      .select('signed_up_at')
      .eq('edition_id', edition.id)
      .neq('status', 'cancelled')
      .limit(ROW_LIMIT),
  ]);

  for (const [label, result] of [['schedule', schedule], ['announcements', notices], ['check_ins', checkIns], ['loans', loans], ['signups', signups]] as const) {
    if (result.error) {
      console.error(`display_feed_${label}_failed`, result.error);
      return response({ error: 'event_unavailable' }, 503);
    }
  }

  const arrivalsAll = firstArrivals((checkIns.data ?? []) as CheckInRow[]);
  const todaysArrivals = dayKey ? arrivalsAll.filter((a) => a.day === dayKey) : [];

  let arrivals: Array<{ id: string; name: string; at: string }> = [];
  if (withNames) {
    const recent = todaysArrivals
      .filter((a) => now.getTime() - Date.parse(a.occurred_at) <= ARRIVAL_WINDOW_MS)
      .sort((a, b) => Date.parse(b.occurred_at) - Date.parse(a.occurred_at))
      .slice(0, MAX_ARRIVALS);
    if (recent.length > 0) {
      const people = await sb
        .from('attendees')
        .select('id, display_name')
        .in('id', recent.map((a) => a.attendee_id));
      if (people.error) {
        // Arrivals are the garnish. Losing them must not blank the programme.
        console.error('display_feed_attendees_failed', people.error);
      } else {
        const names = new Map(((people.data ?? []) as Array<{ id: string; display_name: string | null }>).map((p) => [p.id, firstName(p.display_name)]));
        arrivals = recent
          .map((a) => ({ id: a.id, name: names.get(a.attendee_id) ?? null, at: a.occurred_at }))
          .filter((a): a is { id: string; name: string; at: string } => Boolean(a.name))
          .reverse();
      }
    }
  }

  const loanRows = (loans.data ?? []) as any[];
  const midnight = istMidnight(now);
  const loansToday = loanRows.filter((row) => row.checked_out_at && Date.parse(row.checked_out_at) >= midnight);

  const announcements = ((notices.data ?? []) as any[])
    .filter((item) => item.audience === 'all' || item.audience === dayKey)
    .map((item) => ({
      id: item.id,
      title: item.title,
      body: item.body,
      severity: item.severity,
      starts_at: item.starts_at,
      ends_at: item.ends_at,
      updated_at: item.updated_at,
    }));

  return response({
    ...base,
    edition: {
      slug: edition.slug,
      name: edition.name,
      start_date: edition.start_date,
      end_date: edition.end_date,
      daily_start_time: edition.daily_start_time,
      daily_end_time: edition.daily_end_time,
    },
    day: dayKey,
    schedule: ((schedule.data ?? []) as any[]).map((item) => ({
      id: item.id,
      day: item.day,
      start_time: item.start_time,
      end_time: item.end_time,
      title: item.title,
      location: item.location,
      kind: item.kind,
      section: item.section,
      is_all_day: item.is_all_day,
      host_name: item.host_name,
      public_status: item.public_status,
      display_order: item.display_order,
    })),
    announcements,
    arrivals,
    stats: {
      checked_in_today: todaysArrivals.length,
      checked_in_total: new Set(arrivalsAll.map((a) => a.attendee_id)).size,
      arrivals: countWindows(todaysArrivals.map((a) => a.occurred_at), now),
      loans: countWindows(loanRows.map((row) => row.checked_out_at), now),
      games_out_now: loanRows.filter((row) => row.status === 'checked_out').length,
      top_game_today: topTitle(loansToday.map(titleOf)),
      bookings: countWindows(((signups.data ?? []) as Array<{ signed_up_at: string }>).map((row) => row.signed_up_at), now),
    },
  });
}

export async function handleDisplayFeed(req: Request, env: Env, now = new Date()): Promise<Response> {
  // Per-IP only. The subject limiter (10/min) would be keyed on one shared
  // subject here, so a second screen at the venue would starve the first.
  if (env.PUBLIC_RATE_LIMITER) {
    const ip = req.headers.get('CF-Connecting-IP') || 'local';
    const { success } = await env.PUBLIC_RATE_LIMITER.limit({ key: `display-feed:ip:${ip}` });
    if (!success) return response({ error: 'rate_limited' }, 429);
  }
  return buildDisplayFeed(serviceClient(env), now, displayKeyPresented(req, env.DISPLAY_KEY));
}
