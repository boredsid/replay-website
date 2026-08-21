import type { SupabaseClient } from '@supabase/supabase-js';
import { CORS_HEADERS } from './validation';

const PUBLIC_CACHE = 'public, max-age=60, stale-while-revalidate=300';
const SECTION_ORDER = ['always-on', 'programme', 'playtesting', 'publisher-showcase', 'event-floor'];
const SEVERITY_ORDER = ['incident', 'urgent', 'info'];

function response(body: unknown, status = 200, cacheControl = PUBLIC_CACHE): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': cacheControl,
      ...CORS_HEADERS,
    },
  });
}

/**
 * Return the public, offline-cacheable data needed by the attendee app.
 *
 * The Worker uses a service-role client, so every public-state filter and every
 * response field is explicit here rather than relying on RLS to hide data.
 */
export async function handleAppBootstrap(sb: SupabaseClient, now = new Date()): Promise<Response> {
  const editionResult = await sb
    .from('editions')
    .select('id, slug, name, start_date, end_date, daily_start_time, daily_end_time, venue')
    .eq('is_current', true)
    .eq('is_published', true)
    .maybeSingle();

  if (editionResult.error) {
    console.error('app_bootstrap_edition_failed', editionResult.error);
    return response({ error: 'event_unavailable' }, 503, 'no-store');
  }

  if (!editionResult.data) {
    return response({
      generated_at: now.toISOString(),
      timezone: 'Asia/Kolkata',
      edition: null,
      schedule: [],
      announcements: [],
    });
  }

  const edition = editionResult.data as any;
  const scheduleResult = await sb
    .from('schedule_items')
    .select('id, day, start_time, end_time, title, description, location, kind, section, is_all_day, host_name, signup_mode, signup_url, public_status, display_order')
    .eq('edition_id', edition.id)
    .in('public_status', ['published', 'cancelled'])
    .order('day', { ascending: true })
    .order('section', { ascending: true })
    .order('display_order', { ascending: true })
    .order('start_time', { ascending: true })
    .limit(500);

  if (scheduleResult.error) {
    console.error('app_bootstrap_schedule_failed', scheduleResult.error);
    return response({ error: 'event_unavailable' }, 503, 'no-store');
  }

  const nowIso = now.toISOString();
  const announcementResult = await sb
    .from('announcements')
    .select('id, title, body, severity, audience, starts_at, ends_at, updated_at')
    .eq('edition_id', edition.id)
    .eq('is_published', true)
    .lte('starts_at', nowIso)
    .or(`ends_at.is.null,ends_at.gt.${nowIso}`)
    .order('starts_at', { ascending: false })
    .limit(50);

  if (announcementResult.error) {
    console.error('app_bootstrap_announcements_failed', announcementResult.error);
    return response({ error: 'event_unavailable' }, 503, 'no-store');
  }

  const schedule = (scheduleResult.data ?? []).map((item: any) => ({
    id: item.id,
    day: item.day,
    start_time: item.start_time,
    end_time: item.end_time,
    title: item.title,
    description: item.description,
    location: item.location,
    kind: item.kind,
    section: item.section,
    is_all_day: item.is_all_day,
    host_name: item.host_name,
    signup_mode: item.signup_mode,
    signup_url: item.signup_url,
    public_status: item.public_status,
    display_order: item.display_order,
  })).sort((a: any, b: any) =>
    a.day.localeCompare(b.day)
    || SECTION_ORDER.indexOf(a.section) - SECTION_ORDER.indexOf(b.section)
    || a.display_order - b.display_order
    || (a.start_time ?? '').localeCompare(b.start_time ?? '')
  );

  const announcements = (announcementResult.data ?? []).map((item: any) => ({
    id: item.id,
    title: item.title,
    body: item.body,
    severity: item.severity,
    audience: item.audience,
    starts_at: item.starts_at,
    ends_at: item.ends_at,
    updated_at: item.updated_at,
  })).sort((a: any, b: any) =>
    SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity)
    || b.starts_at.localeCompare(a.starts_at)
  );

  return response({
    generated_at: now.toISOString(),
    timezone: 'Asia/Kolkata',
    edition: {
      slug: edition.slug,
      name: edition.name,
      start_date: edition.start_date,
      end_date: edition.end_date,
      daily_start_time: edition.daily_start_time,
      daily_end_time: edition.daily_end_time,
      venue: edition.venue,
    },
    schedule,
    announcements,
  });
}
