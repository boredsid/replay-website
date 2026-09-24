// worker/src/recap.ts
//
// GET /api/recap/:slug — what an edition added up to, once it is over.
//
// The public site reads this during `astro build` to draw the between-editions
// recap: people through the door, sessions booked, games borrowed. Every
// figure comes from a table the site cannot read itself (check-ins, bookings,
// loans), so this is their one public projection, the way /api/catalogue is
// the library's.
//
// The counting happens in Postgres (`edition_recap`, migration
// 20260924180138_between_editions.sql) because PostgREST caps a select at
// 1,000 rows and a Worker-side count would undercount a larger edition without
// an error. This module only decides who may see it and trims the answer to
// the published contract.
//
// Design: docs/specs/2026-09-24-between-editions-design.md

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Env } from './index';
import { CORS_HEADERS } from './validation';
import { serviceClient } from './supabase';
import { istDate } from './display-feed';

export interface RecapBody {
  edition: { slug: string; start_date: string; end_date: string };
  attendance: { people: number; by_day: Record<string, number>; both_days: number };
  sessions: {
    seats_booked: number;
    sessions_booked: number;
    by_item: Array<{ schedule_item_id: string; booked: number }>;
  };
  library: { loans: number; most_borrowed: Array<{ title: string; loans: number }> };
}

type Shaped = Omit<RecapBody, 'edition'>;

const SLUG = /^[a-z0-9][a-z0-9-]{0,62}$/;

function count(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function list(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

/**
 * Trims whatever the database returned to exactly the published contract.
 *
 * Anything the function grows later stays private until somebody adds it
 * here on purpose, and the test that pins the keys fails until they do.
 */
export function shapeRecap(raw: unknown): Shaped {
  const root = record(raw);
  const attendance = record(root.attendance);
  const sessions = record(root.sessions);
  const library = record(root.library);

  const byDay: Record<string, number> = {};
  for (const [day, n] of Object.entries(record(attendance.by_day))) {
    if (day === 'day1' || day === 'day2') byDay[day] = count(n);
  }

  return {
    attendance: {
      people: count(attendance.people),
      by_day: byDay,
      both_days: count(attendance.both_days),
    },
    sessions: {
      seats_booked: count(sessions.seats_booked),
      sessions_booked: count(sessions.sessions_booked),
      by_item: list(sessions.by_item)
        .map(record)
        .filter((row) => typeof row.schedule_item_id === 'string')
        .map((row) => ({ schedule_item_id: row.schedule_item_id as string, booked: count(row.booked) })),
    },
    library: {
      loans: count(library.loans),
      most_borrowed: list(library.most_borrowed)
        .map(record)
        .filter((row) => typeof row.title === 'string' && row.title.trim() !== '')
        .slice(0, 5)
        .map((row) => ({ title: (row.title as string).trim(), loans: count(row.loans) })),
    },
  };
}

function respond(body: unknown, status: number, cache: string): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': cache,
      ...CORS_HEADERS,
    },
  });
}

const notFound = () => respond({ error: 'not_found' }, 404, 'no-store');

/**
 * Only a published edition that has finished has a public recap. A draft has
 * nothing to show, and an edition still running would publish a live head
 * count nobody decided to publish.
 */
export async function buildRecap(sb: SupabaseClient, slug: string, now: Date): Promise<Response> {
  if (!SLUG.test(slug)) return notFound();

  const { data: edition, error } = await sb
    .from('editions')
    .select('id, slug, start_date, end_date, is_published')
    .eq('slug', slug)
    .maybeSingle();
  if (error) {
    console.error('recap_edition_lookup_failed', error.message);
    return respond({ error: 'recap_unavailable' }, 503, 'no-store');
  }
  if (!edition || !edition.is_published || !(edition.end_date < istDate(now))) return notFound();

  const recap = await sb.rpc('edition_recap', { p_edition_id: edition.id });
  if (recap.error) {
    console.error('recap_failed', recap.error.message);
    return respond({ error: 'recap_unavailable' }, 503, 'no-store');
  }

  const body: RecapBody = {
    edition: { slug: edition.slug, start_date: edition.start_date, end_date: edition.end_date },
    ...shapeRecap(recap.data),
  };
  return respond(body, 200, 'public, max-age=300');
}

export async function handleRecap(req: Request, env: Env, slug: string, now = new Date()): Promise<Response> {
  if (env.PUBLIC_RATE_LIMITER) {
    const ip = req.headers.get('CF-Connecting-IP') || 'local';
    const { success } = await env.PUBLIC_RATE_LIMITER.limit({ key: `recap:ip:${ip}` });
    if (!success) return respond({ error: 'rate_limited' }, 429, 'no-store');
  }
  return buildRecap(serviceClient(env), slug, now);
}
