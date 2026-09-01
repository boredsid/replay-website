import { describe, expect, it, vi } from 'vitest';
import { handleAppBootstrap } from './app-bootstrap';

function query(result: any, terminal: 'maybeSingle' | 'limit') {
  const chain: any = {};
  for (const method of ['select', 'eq', 'in', 'lte', 'or', 'order']) {
    chain[method] = vi.fn(() => chain);
  }
  chain.maybeSingle = vi.fn(async () => terminal === 'maybeSingle' ? result : undefined);
  chain.limit = vi.fn(async () => terminal === 'limit' ? result : undefined);
  return chain;
}

function client(
  editionResult: any,
  scheduleResult: any = { data: [], error: null },
  announcementResult: any = { data: [], error: null },
) {
  const editionQuery = query(editionResult, 'maybeSingle');
  const scheduleQuery = query(scheduleResult, 'limit');
  const announcementQuery = query(announcementResult, 'limit');
  const from = vi.fn((table: string) => {
    if (table === 'editions') return editionQuery;
    if (table === 'schedule_items') return scheduleQuery;
    if (table === 'announcements') return announcementQuery;
    throw new Error(`unexpected table ${table}`);
  });
  return { sb: { from } as any, editionQuery, scheduleQuery, announcementQuery, from };
}

const edition = {
  id: 'edition-private-id',
  slug: 'replay-3',
  name: 'REPLAY',
  start_date: '2026-09-12',
  end_date: '2026-09-13',
  daily_start_time: '10:00:00',
  daily_end_time: '19:00:00',
  venue: 'TBD',
  pricing: { oneshot: 700 },
  capacity_per_day: { day1: 250 },
};

describe('handleAppBootstrap', () => {
  it('returns an offline-cacheable empty state when no current edition is published', async () => {
    const { sb, from } = client({ data: null, error: null });
    const res = await handleAppBootstrap(sb, new Date('2026-08-20T12:00:00.000Z'));

    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('public, max-age=60, stale-while-revalidate=300');
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
    expect(await res.json()).toEqual({
      generated_at: '2026-08-20T12:00:00.000Z',
      timezone: 'Asia/Kolkata',
      edition: null,
      schedule: [],
      announcements: [],
    });
    expect(from).toHaveBeenCalledTimes(1);
  });

  it('returns only allowlisted edition and programme fields', async () => {
    const scheduleItem = {
      id: 'item-1', day: '2026-09-12', start_time: '10:00:00', end_time: '11:00:00',
      title: 'Learn a game', description: 'Friendly table', location: 'Room A', kind: 'workshop',
      section: 'programme', is_all_day: false, host_name: 'Host', signup_mode: 'walk-in',
      signup_url: null, public_status: 'published', display_order: 2,
      created_at: 'private-implementation-detail', edition_id: 'edition-private-id',
    };
    const announcement = {
      id: 'notice-1', title: 'Room change', body: 'Meet in Room B', severity: 'urgent', audience: 'day1',
      starts_at: '2026-08-20T11:00:00.000Z', ends_at: null, updated_at: '2026-08-20T11:01:00.000Z',
      edition_id: 'edition-private-id', is_published: true, created_at: 'private',
    };
    const { sb, editionQuery, scheduleQuery, announcementQuery } = client(
      { data: edition, error: null },
      { data: [scheduleItem], error: null },
      { data: [announcement], error: null },
    );

    const res = await handleAppBootstrap(sb, new Date('2026-08-20T12:00:00.000Z'));
    const body: any = await res.json();

    expect(editionQuery.eq).toHaveBeenCalledWith('is_current', true);
    expect(editionQuery.eq).toHaveBeenCalledWith('is_published', true);
    expect(scheduleQuery.eq).toHaveBeenCalledWith('edition_id', 'edition-private-id');
    expect(scheduleQuery.in).toHaveBeenCalledWith('public_status', ['published', 'cancelled']);
    expect(scheduleQuery.limit).toHaveBeenCalledWith(500);
    expect(announcementQuery.eq).toHaveBeenCalledWith('edition_id', 'edition-private-id');
    expect(announcementQuery.eq).toHaveBeenCalledWith('is_published', true);
    expect(announcementQuery.lte).toHaveBeenCalledWith('starts_at', '2026-08-20T12:00:00.000Z');
    expect(announcementQuery.or).toHaveBeenCalledWith('ends_at.is.null,ends_at.gt.2026-08-20T12:00:00.000Z');
    expect(announcementQuery.limit).toHaveBeenCalledWith(50);
    expect(body.edition).toEqual({
      slug: 'replay-3', name: 'REPLAY', start_date: '2026-09-12', end_date: '2026-09-13',
      daily_start_time: '10:00:00', daily_end_time: '19:00:00', venue: 'TBD',
      // Unpublished visit guidance is present but null, so the app has a single
      // "not confirmed yet" check rather than distinguishing missing from blank.
      venue_address: null, google_maps_url: null, entrance_details: null, check_in_location: null,
      nearest_metro_name: null, nearest_metro_distance: null,
      nearest_bus_stop_name: null, nearest_bus_stop_distance: null,
      parking_availability: null, parking_charges: null,
      food_details: null, water_details: null, accessibility_details: null,
      game_library_process: null, help_on_the_day: null,
    });
    expect(body.edition).not.toHaveProperty('id');
    expect(body.edition).not.toHaveProperty('pricing');
    expect(body.edition).not.toHaveProperty('capacity_per_day');
    expect(body.schedule).toEqual([{
      ...scheduleItem, created_at: undefined, edition_id: undefined,
      // Capacity and remaining seats are counts, never identities — the payload
      // still says nothing about who signed up. Null here because this item is
      // walk-in rather than app-bookable.
      capacity: null, seats_remaining: null,
    }].map(({ created_at: _created, edition_id: _edition, ...item }) => item));
    expect(body.announcements).toEqual([{
      id: 'notice-1', title: 'Room change', body: 'Meet in Room B', severity: 'urgent', audience: 'day1',
      starts_at: '2026-08-20T11:00:00.000Z', ends_at: null, updated_at: '2026-08-20T11:01:00.000Z',
    }]);
  });

  it('serves published visit guidance so the at-venue app matches the public site', async () => {
    const { sb, editionQuery } = client({
      data: {
        ...edition,
        venue: 'Indiqube Symphony, MG Road',
        venue_address: 'Craig Park Layout, Ashok Nagar, Bangalore',
        google_maps_url: 'https://maps.google.com/?cid=123',
        entrance_details: 'Terrace on the 7th floor, rear building.',
        check_in_location: 'Registration booth at the con entrance.',
        nearest_metro_name: 'Trinity (Purple line)',
        nearest_metro_distance: '5 min walk',
        nearest_bus_stop_name: 'Mayo Hall',
        nearest_bus_stop_distance: '10 min walk',
        parking_availability: 'Available at the venue',
        parking_charges: '₹100 per hour',
        food_details: 'Restaurants and cafes in the campus.',
        water_details: 'Water jugs provided; bring a bottle.',
        accessibility_details: 'Step-free access via the lift.',
        game_library_process: 'Borrow at the library desk.',
        help_on_the_day: 'Look for a How Can I Help sticker.',
        // Blank strings are organiser drafts, not published guidance.
        nearest_bus_stop_name_unused: 'ignored',
      },
      error: null,
    });

    const res = await handleAppBootstrap(sb, new Date('2026-08-20T12:00:00.000Z'));
    const body: any = await res.json();

    expect(editionQuery.select).toHaveBeenCalledWith(expect.stringContaining('venue_address'));
    expect(editionQuery.select).toHaveBeenCalledWith(expect.stringContaining('help_on_the_day'));
    expect(body.edition.google_maps_url).toBe('https://maps.google.com/?cid=123');
    expect(body.edition.entrance_details).toBe('Terrace on the 7th floor, rear building.');
    expect(body.edition.nearest_metro_name).toBe('Trinity (Purple line)');
    expect(body.edition.parking_charges).toBe('₹100 per hour');
    expect(body.edition.help_on_the_day).toBe('Look for a How Can I Help sticker.');
    // Still an allowlist: unknown columns never reach the public payload.
    expect(body.edition).not.toHaveProperty('nearest_bus_stop_name_unused');
    expect(body.edition).not.toHaveProperty('id');
  });

  it('treats blank visit fields as unpublished', async () => {
    const { sb } = client({
      data: { ...edition, venue_address: '   ', food_details: '', help_on_the_day: 'Ask a volunteer.' },
      error: null,
    });

    const body: any = await (await handleAppBootstrap(sb)).json();

    expect(body.edition.venue_address).toBeNull();
    expect(body.edition.food_details).toBeNull();
    expect(body.edition.help_on_the_day).toBe('Ask a volunteer.');
  });

  it('fails closed without cache when the edition query fails', async () => {
    const { sb } = client({ data: null, error: { message: 'nope' } });
    const res = await handleAppBootstrap(sb);
    expect(res.status).toBe(503);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    expect(await res.json()).toEqual({ error: 'event_unavailable' });
  });

  it('fails closed without cache when the schedule query fails', async () => {
    const { sb } = client({ data: edition, error: null }, { data: null, error: { message: 'nope' } });
    const res = await handleAppBootstrap(sb);
    expect(res.status).toBe(503);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
  });

  it('fails closed without cache when the announcement query fails', async () => {
    const { sb } = client(
      { data: edition, error: null },
      { data: [], error: null },
      { data: null, error: { message: 'nope' } },
    );
    const res = await handleAppBootstrap(sb);
    expect(res.status).toBe(503);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
  });

  it('places incident notices before urgent and informational notices', async () => {
    const base = { body: 'Details', audience: 'all', ends_at: null, updated_at: '2026-08-20T12:00:00.000Z' };
    const { sb } = client({ data: edition, error: null }, { data: [], error: null }, { data: [
      { ...base, id: 'info', title: 'Info', severity: 'info', starts_at: '2026-08-20T11:00:00.000Z' },
      { ...base, id: 'urgent', title: 'Urgent', severity: 'urgent', starts_at: '2026-08-20T10:00:00.000Z' },
      { ...base, id: 'incident', title: 'Incident', severity: 'incident', starts_at: '2026-08-20T09:00:00.000Z' },
    ], error: null });
    const body: any = await (await handleAppBootstrap(sb)).json();
    expect(body.announcements.map((item: any) => item.id)).toEqual(['incident', 'urgent', 'info']);
  });

  it('uses the same public section order as the website programme', async () => {
    const base = {
      day: '2026-09-12', start_time: null, end_time: null, description: null, location: null,
      kind: 'special', is_all_day: true, host_name: null, signup_mode: 'none', signup_url: null,
      public_status: 'published', display_order: 0,
    };
    const { sb } = client({ data: edition, error: null }, { data: [
      { ...base, id: 'floor', title: 'Floor', section: 'event-floor' },
      { ...base, id: 'programme', title: 'Programme', section: 'programme' },
      { ...base, id: 'always', title: 'Always', section: 'always-on' },
    ], error: null });
    const body: any = await (await handleAppBootstrap(sb)).json();
    expect(body.schedule.map((item: any) => item.id)).toEqual(['always', 'programme', 'floor']);
  });
});
