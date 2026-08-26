import { describe, expect, it } from 'vitest';
import { handleScheduleCreate, handleSchedulePatch } from './schedule';

const ORIGIN = 'https://admin.replaycon.in';
const BASE = {
  edition_id: 'edition-3',
  day: '2026-09-12',
  title: 'Open board games',
  section: 'always-on',
  kind: 'open-play',
  is_all_day: true,
  signup_mode: 'walk-in',
  public_status: 'published',
  display_order: 0,
};

describe('handleScheduleCreate', () => {
  it('creates an all-day item without fake times and writes an audit row', async () => {
    let inserted: any = null;
    let audit: any = null;
    const sb: any = {
      from: (table: string) => {
        if (table === 'editions') return {
          select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { start_date: '2026-09-12', end_date: '2026-09-13' }, error: null }) }) }),
        };
        if (table === 'schedule_items') return {
          insert: (row: any) => {
            inserted = row;
            return { select: () => ({ single: async () => ({ data: { id: 'item-1', ...row }, error: null }) }) };
          },
        };
        if (table === 'admin_audit_log') return { insert: async (row: any) => { audit = row; return { error: null }; } };
        return {};
      },
    };
    const req = new Request('https://x/api/admin/schedule', { method: 'POST', body: JSON.stringify(BASE) });
    const res = await handleScheduleCreate(req, sb, 'sid@x.com', ORIGIN);
    expect(res.status).toBe(200);
    expect(inserted.start_time).toBeNull();
    expect(inserted.end_time).toBeNull();
    expect(audit.action).toBe('schedule.create');
  });

  it('requires valid start and end times for a timed item', async () => {
    const req = new Request('https://x/api/admin/schedule', {
      method: 'POST',
      body: JSON.stringify({ ...BASE, section: 'programme', is_all_day: false }),
    });
    const res = await handleScheduleCreate(req, {} as any, 'sid@x.com', ORIGIN);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'invalid_times' });
  });

  it('accepts story-game as an activity type and rejects an unknown one', async () => {
    let inserted: any = null;
    const sb: any = {
      from: (table: string) => {
        if (table === 'editions') return {
          select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { start_date: '2026-09-12', end_date: '2026-09-13' }, error: null }) }) }),
        };
        if (table === 'schedule_items') return {
          insert: (row: any) => {
            inserted = row;
            return { select: () => ({ single: async () => ({ data: { id: 'item-2', ...row }, error: null }) }) };
          },
        };
        if (table === 'admin_audit_log') return { insert: async () => ({ error: null }) };
        return {};
      },
    };
    const body = { ...BASE, section: 'programme', kind: 'story-game', is_all_day: false, start_time: '14:00', end_time: '17:00' };
    const ok = await handleScheduleCreate(new Request('https://x/api/admin/schedule', { method: 'POST', body: JSON.stringify(body) }), sb, 'sid@x.com', ORIGIN);
    expect(ok.status).toBe(200);
    expect(inserted.kind).toBe('story-game');

    const bad = await handleScheduleCreate(
      new Request('https://x/api/admin/schedule', { method: 'POST', body: JSON.stringify({ ...body, kind: 'story game' }) }),
      sb,
      'sid@x.com',
      ORIGIN,
    );
    expect(bad.status).toBe(400);
    expect(await bad.json()).toEqual({ error: 'invalid_kind' });
  });

  it('rejects a day outside the selected edition', async () => {
    const sb: any = {
      from: () => ({
        select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { start_date: '2026-09-12', end_date: '2026-09-13' }, error: null }) }) }),
      }),
    };
    const req = new Request('https://x/api/admin/schedule', { method: 'POST', body: JSON.stringify({ ...BASE, day: '2026-09-14' }) });
    const res = await handleScheduleCreate(req, sb, 'sid@x.com', ORIGIN);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'day_outside_edition' });
  });
});

describe('handleSchedulePatch', () => {
  it('updates a timed item and records the public-status change', async () => {
    const before = {
      id: 'item-1',
      ...BASE,
      section: 'programme',
      kind: 'workshop',
      is_all_day: false,
      start_time: '10:00:00',
      end_time: '11:00:00',
      public_status: 'draft',
      description: null,
      location: null,
      host_name: null,
      signup_url: null,
    };
    let updated: any = null;
    let audit: any = null;
    const sb: any = {
      from: (table: string) => {
        if (table === 'schedule_items') return {
          select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: before, error: null }) }) }),
          update: (row: any) => {
            updated = row;
            return { eq: () => ({ select: () => ({ single: async () => ({ data: { id: 'item-1', ...row }, error: null }) }) }) };
          },
        };
        if (table === 'editions') return {
          select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { start_date: '2026-09-12', end_date: '2026-09-13' }, error: null }) }) }),
        };
        if (table === 'admin_audit_log') return { insert: async (row: any) => { audit = row; return { error: null }; } };
        return {};
      },
    };
    const req = new Request('https://x/api/admin/schedule/item-1', { method: 'PATCH', body: JSON.stringify({ public_status: 'published' }) });
    const res = await handleSchedulePatch(req, sb, 'item-1', 'sid@x.com', ORIGIN);
    expect(res.status).toBe(200);
    expect(updated.start_time).toBe('10:00');
    expect(updated.public_status).toBe('published');
    expect(audit.action).toBe('schedule.update');
    expect(audit.diff.public_status).toEqual({ old: 'draft', new: 'published' });
  });

  it('rejects a non-http sign-up URL', async () => {
    const before = { id: 'item-1', ...BASE, start_time: null, end_time: null, description: null, location: null, host_name: null, signup_url: null };
    const sb: any = {
      from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: before, error: null }) }) }) }),
    };
    const req = new Request('https://x/api/admin/schedule/item-1', { method: 'PATCH', body: JSON.stringify({ signup_url: 'javascript:alert(1)' }) });
    const res = await handleSchedulePatch(req, sb, 'item-1', 'sid@x.com', ORIGIN);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'invalid_signup_url' });
  });
});
