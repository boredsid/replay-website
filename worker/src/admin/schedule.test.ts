import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('../editions', () => ({ getCurrentEdition: vi.fn() }));
import { getCurrentEdition } from '../editions';
import { handleScheduleList, handleScheduleCreate, handleSchedulePatch, handleScheduleDelete } from './schedule';

const ORIGIN = 'https://admin.replaycon.in';
const BASE = {
  edition_id: 'edition-3',
  day: '2026-09-12',
  title: 'Open board games',
  section: 'always-on',
  kind: 'open-play',
  is_all_day: true,
  signup_mode: 'none',
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

  it('rejects a sign-up mode that no longer exists', async () => {
    const before = { id: 'item-1', ...BASE, start_time: '10:00:00', end_time: '11:00:00', description: null, location: null, host_name: null };
    const sb: any = {
      from: (table: string) => {
        if (table === 'schedule_items') return {
          select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: before, error: null }) }) }),
        };
        return {};
      },
    };
    const req = new Request('https://x/api/admin/schedule/item-1', { method: 'PATCH', body: JSON.stringify({ signup_mode: 'walk-in' }) });
    const res = await handleSchedulePatch(req, sb, 'item-1', 'sid@example.com', ORIGIN);

    // The retired modes must be refused by the API too, not only by the database.
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'invalid_signup_mode' });
  });
});

describe('handleScheduleDelete', () => {
  function client(options: { item?: any; signups?: any[] }) {
    const state = { deleted: false, audit: null as any };
    const sb: any = {
      from: (table: string) => {
        if (table === 'schedule_items') return {
          select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: options.item ?? null, error: null }) }) }),
          delete: () => ({ eq: async () => { state.deleted = true; return { error: null }; } }),
        };
        if (table === 'session_signups') return {
          select: () => ({ eq: () => ({ neq: async () => ({ data: options.signups ?? [], error: null }) }) }),
        };
        if (table === 'admin_audit_log') return { insert: async (row: any) => { state.audit = row; return { error: null }; } };
        return {};
      },
    };
    return { sb, state };
  }

  it('deletes an item nobody has booked and writes an audit row', async () => {
    const { sb, state } = client({ item: { id: 'item-1', title: 'Open board games' } });
    const res = await handleScheduleDelete(sb, 'item-1', 'sid@x.com', ORIGIN);
    expect(res.status).toBe(200);
    expect(state.deleted).toBe(true);
    expect(state.audit).toMatchObject({ action: 'schedule.delete', target_table: 'schedule_items', target_id: 'item-1' });
  });

  it('refuses to delete a session people have booked, and says how many', async () => {
    const { sb, state } = client({ item: { id: 'item-1', title: 'Fiasco' }, signups: [{ id: 's1' }, { id: 's2' }] });
    const res = await handleScheduleDelete(sb, 'item-1', 'sid@x.com', ORIGIN);
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: 'session_has_signups', signup_count: 2 });
    expect(state.deleted).toBe(false);
  });

  it('404s on an item that is not there', async () => {
    const { sb } = client({});
    const res = await handleScheduleDelete(sb, 'missing', 'sid@x.com', ORIGIN);
    expect(res.status).toBe(404);
  });
});

describe('handleScheduleList', () => {
  /** A schedule_items table that records which edition it was asked about. */
  function stub() {
    const asked: { editionId?: string } = {};
    const chain: any = {
      select: () => chain,
      eq: (_col: string, value: string) => { asked.editionId = value; return chain; },
      order: () => chain,
      then: (resolve: any) => resolve({ data: [{ id: 'item-1' }], error: null }),
    };
    return { asked, sb: { from: () => chain } as any };
  }

  beforeEach(() => { vi.mocked(getCurrentEdition).mockReset(); });

  it('answers for the edition that is on when none is named', async () => {
    // The read-only case: editions are admin-only, so this caller has no id to
    // send and would otherwise get a 400 it could never fix.
    vi.mocked(getCurrentEdition).mockResolvedValue({ id: 'edition-3' } as never);
    const { asked, sb } = stub();
    const res = await handleScheduleList(new Request('https://x/api/admin/schedule'), {} as any, sb, ORIGIN);
    expect(res.status).toBe(200);
    expect(asked.editionId).toBe('edition-3');
    expect(await res.json()).toEqual({ items: [{ id: 'item-1' }], edition_id: 'edition-3' });
  });

  it('still honours an edition it was given, without asking which is current', async () => {
    const { asked, sb } = stub();
    const req = new Request('https://x/api/admin/schedule?edition_id=edition-1');
    const res = await handleScheduleList(req, {} as any, sb, ORIGIN);
    expect(res.status).toBe(200);
    expect(asked.editionId).toBe('edition-1');
    expect(getCurrentEdition).not.toHaveBeenCalled();
  });

  it('says so when nothing is current and no edition was named', async () => {
    vi.mocked(getCurrentEdition).mockResolvedValue(null as never);
    const res = await handleScheduleList(new Request('https://x/api/admin/schedule'), {} as any, {} as any, ORIGIN);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'no_edition' });
  });
});
