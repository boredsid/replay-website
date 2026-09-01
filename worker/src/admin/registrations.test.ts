import { describe, it, expect, vi } from 'vitest';
vi.mock('../editions', () => ({
  getEditionBySlug: vi.fn(async () => ({ id: 'e1', slug: 'replay-3', venue: 'V', start_date: '2026-09-12', end_date: '2026-09-13', capacity_per_day: { day1: 250, day2: 250 } })),
  getCurrentEdition: vi.fn(async () => ({ id: 'e1', slug: 'replay-3', venue: 'V', start_date: '2026-09-12', end_date: '2026-09-13', capacity_per_day: { day1: 250, day2: 250 } })),
  getReservedSeatsByDay: vi.fn(async () => ({ day1: 0, day2: 0 })),
}));
vi.mock('../registration-email', () => ({ sendRegistrationConfirmation: vi.fn(async () => {}) }));
import { handleRegPatch, handleRegCreate } from './registrations';
import { sendRegistrationConfirmation } from '../registration-email';

const O = 'https://admin.replaycon.in';

describe('handleRegPatch', () => {
  it('updates payment_status and writes an audit diff', async () => {
    const audit: any = {};
    const sb: any = {
      from: (t: string) => {
        if (t === 'registrations') return {
          select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { id: 'r1', payment_status: 'pending', amount_paid: 800 }, error: null }) }) }),
          update: () => ({ eq: () => ({ select: () => ({ single: async () => ({ data: { id: 'r1', payment_status: 'confirmed', amount_paid: 800 }, error: null }) }) }) }),
        };
        if (t === 'admin_audit_log') return { insert: async (row: any) => { audit.row = row; return { error: null }; } };
        return {} as any;
      },
    };
    const req = new Request('https://api.x/api/admin/registrations/r1', { method: 'PATCH', body: JSON.stringify({ payment_status: 'confirmed' }) });
    const res = await handleRegPatch(req, {} as any, sb, 'r1', 'sid@x.com', O);
    expect(res.status).toBe(200);
    expect(audit.row.action).toBe('registration.update');
    expect(audit.row.diff.payment_status).toEqual({ old: 'pending', new: 'confirmed' });
  });

  it('returns 404 when registration missing', async () => {
    const sb: any = { from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }) }) };
    const req = new Request('https://api.x/api/admin/registrations/rX', { method: 'PATCH', body: JSON.stringify({ payment_status: 'confirmed' }) });
    const res = await handleRegPatch(req, {} as any, sb, 'rX', 'sid@x.com', O);
    expect(res.status).toBe(404);
  });

  it('sends the confirmation email only when a pending registration becomes confirmed', async () => {
    const edition = {
      id: 'e1', slug: 'replay-3', name: 'REPLAY', start_date: '2026-09-12', end_date: '2026-09-13',
      daily_start_time: '10:00:00', daily_end_time: '19:00:00', venue: 'V',
      capacity_per_day: { day1: 250, day2: 250 }, pricing: {}, registration_status: 'open', is_current: true, is_published: true,
    };
    const before = {
      id: 'r1', edition_id: 'e1', user_phone: '9876543210', pass_type: 'oneshot', days: ['day1'],
      seats: 2, payment_status: 'pending', amount_paid: 1600, discount_applied: 0, guild_tier_at_purchase: null,
      users: { name: 'Asha', email: 'asha@example.com' }, editions: edition,
    };
    const sb: any = {
      from: (table: string) => {
        if (table === 'registrations') return {
          select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: before, error: null }) }) }),
          update: () => ({ eq: () => ({ select: () => ({ single: async () => ({ data: { ...before, payment_status: 'confirmed' }, error: null }) }) }) }),
        };
        if (table === 'admin_audit_log') return { insert: async () => ({ error: null }) };
        throw new Error(`unexpected table ${table}`);
      },
    };

    const req = new Request('https://api.x/api/admin/registrations/r1', { method: 'PATCH', body: JSON.stringify({ payment_status: 'confirmed' }) });
    const res = await handleRegPatch(req, {} as any, sb, 'r1', 'sid@x.com', O);
    const body: any = await res.json();

    expect(res.status).toBe(200);
    expect(body.email_sent).toBe(true);
    expect(sendRegistrationConfirmation).toHaveBeenCalledTimes(1);
    expect(sendRegistrationConfirmation).toHaveBeenCalledWith(
      expect.anything(),
      edition,
      expect.objectContaining({ seats: 2, amountPaid: 1600 }),
    );
  });
});

describe('handleRegCreate', () => {
  it('rejects invalid phone', async () => {
    const sb: any = { from: () => ({}) };
    const req = new Request('https://api.x/api/admin/registrations', { method: 'POST', body: JSON.stringify({ phone: '12', pass_type: 'oneshot', days: ['day1'] }) });
    const res = await handleRegCreate(req, {} as any, sb, 'sid@x.com', O);
    expect(res.status).toBe(400);
  });

  it('creates a registration, upserts user, writes audit', async () => {
    const audit: any = {};
    let insertedReg: any = null;
    const sb: any = {
      from: (t: string) => {
        if (t === 'users') return {
          select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }),
          insert: () => ({ select: () => ({ single: async () => ({ data: { phone: '9876543210' }, error: null }) }) }),
        };
        if (t === 'registrations') return {
          insert: (row: any) => { insertedReg = row; return { select: () => ({ single: async () => ({ data: { id: 'r9', ...row }, error: null }) }) }; },
        };
        if (t === 'admin_audit_log') return { insert: async (row: any) => { audit.row = row; return { error: null }; } };
        return {} as any;
      },
    };
    const req = new Request('https://api.x/api/admin/registrations', {
      method: 'POST',
      body: JSON.stringify({ phone: '9876543210', name: 'Asha', pass_type: 'oneshot', days: ['day1'], amount_paid: 800, payment_status: 'confirmed', send_email: false }),
    });
    const res = await handleRegCreate(req, {} as any, sb, 'sid@x.com', O);
    expect(res.status).toBe(200);
    expect(insertedReg.source).toEqual({ manual: true, by: 'sid@x.com' });
    expect(audit.row.action).toBe('registration.create');
  });
});

describe('handleRegPatch — editing the pass', () => {
  const BASE = {
    id: 'r1', edition_id: 'e1', user_phone: '9876543210', pass_type: 'oneshot', days: ['day1'],
    seats: 2, payment_status: 'pending', amount_paid: 1600, discount_applied: 0,
    guild_tier_at_purchase: null, promo_code: null, users: { name: 'Asha', email: 'asha@example.com' },
    editions: null,
  };

  /**
   * `before` is BASE unless overridden. `updateError` fakes a trigger raising,
   * `attendees`/`events` back the day-drop guard.
   */
  function makeSb(opts: {
    before?: any;
    updateError?: { message: string };
    attendees?: Array<{ id: string }>;
    events?: Array<{ day: string }>;
  } = {}) {
    const calls: any = { patch: null, audit: null, eventDays: null };
    const sb: any = {
      from: (t: string) => {
        if (t === 'registrations') return {
          select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: opts.before ?? BASE, error: null }) }) }),
          update: (patch: any) => {
            calls.patch = patch;
            return { eq: () => ({ select: () => ({ single: async () => (
              opts.updateError
                ? { data: null, error: opts.updateError }
                : { data: { ...(opts.before ?? BASE), ...patch }, error: null }
            ) }) }) };
          },
        };
        if (t === 'attendees') return {
          select: () => ({ eq: async () => ({ data: opts.attendees ?? [{ id: 'a1' }], error: null }) }),
        };
        if (t === 'check_in_events') return {
          select: () => ({ in: () => ({ in: async (_col: string, days: string[]) => {
            calls.eventDays = days;
            return { data: opts.events ?? [], error: null };
          } }) }),
        };
        if (t === 'admin_audit_log') return { insert: async (row: any) => { calls.audit = row; return { error: null }; } };
        throw new Error(`unexpected table ${t}`);
      },
    };
    return { sb, calls };
  }

  function patchReq(body: unknown) {
    return new Request('https://api.x/api/admin/registrations/r1', { method: 'PATCH', body: JSON.stringify(body) });
  }

  it('updates pass type, days, seats and amount together', async () => {
    const { sb, calls } = makeSb();
    const res = await handleRegPatch(
      patchReq({ pass_type: 'campaign', days: ['day1', 'day2'], seats: 3, amount_paid: 3000 }),
      {} as any, sb, 'r1', 'sid@x.com', O,
    );
    expect(res.status).toBe(200);
    expect(calls.patch).toEqual({ pass_type: 'campaign', days: ['day1', 'day2'], seats: 3, amount_paid: 3000 });
    expect(calls.audit.diff.seats).toEqual({ old: 2, new: 3 });
  });

  it('rejects a pass type that no longer matches the stored days', async () => {
    const { sb, calls } = makeSb();
    const res = await handleRegPatch(patchReq({ pass_type: 'campaign' }), {} as any, sb, 'r1', 'sid@x.com', O);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'pass_days_mismatch' });
    expect(calls.patch).toBeNull();
  });

  it('rejects a seat count outside 1..20', async () => {
    const { sb } = makeSb();
    expect((await handleRegPatch(patchReq({ seats: 0 }), {} as any, sb, 'r1', 'sid@x.com', O)).status).toBe(400);
    expect((await handleRegPatch(patchReq({ seats: 21 }), {} as any, sb, 'r1', 'sid@x.com', O)).status).toBe(400);
    expect((await handleRegPatch(patchReq({ seats: 1.5 }), {} as any, sb, 'r1', 'sid@x.com', O)).status).toBe(400);
  });

  it('refuses to drop a day that already has a check-in', async () => {
    const before = { ...BASE, pass_type: 'campaign', days: ['day1', 'day2'] };
    const { sb, calls } = makeSb({ before, events: [{ day: 'day2' }] });
    const res = await handleRegPatch(
      patchReq({ pass_type: 'oneshot', days: ['day1'] }), {} as any, sb, 'r1', 'sid@x.com', O,
    );
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: 'day_checked_in', day: 'day2' });
    expect(calls.eventDays).toEqual(['day2']);
    expect(calls.patch).toBeNull();
  });

  it('allows dropping a day nobody checked in for', async () => {
    const before = { ...BASE, pass_type: 'campaign', days: ['day1', 'day2'] };
    const { sb, calls } = makeSb({ before, events: [] });
    const res = await handleRegPatch(
      patchReq({ pass_type: 'oneshot', days: ['day1'] }), {} as any, sb, 'r1', 'sid@x.com', O,
    );
    expect(res.status).toBe(200);
    expect(calls.patch.days).toEqual(['day1']);
  });

  it('translates a blocked seat reduction into seats_in_use', async () => {
    const { sb } = makeSb({ updateError: { message: 'seat_reduction_blocked:1 seats are in use' } });
    const res = await handleRegPatch(patchReq({ seats: 1 }), {} as any, sb, 'r1', 'sid@x.com', O);
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: 'seats_in_use' });
  });

  it('translates a capacity trigger failure into sold_out', async () => {
    const { sb } = makeSb({ updateError: { message: 'capacity_exceeded:day2' } });
    const res = await handleRegPatch(patchReq({ days: ['day2'] }), {} as any, sb, 'r1', 'sid@x.com', O);
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: 'sold_out', day: 'day2' });
  });

  it('confirms and emails the pass as edited in the same request', async () => {
    (sendRegistrationConfirmation as any).mockClear();
    const edition = { id: 'e1', slug: 'replay-3' };
    const { sb } = makeSb({ before: { ...BASE, editions: edition } });
    const res = await handleRegPatch(
      patchReq({ pass_type: 'campaign', days: ['day1', 'day2'], amount_paid: 3000, payment_status: 'confirmed' }),
      {} as any, sb, 'r1', 'sid@x.com', O,
    );
    expect(res.status).toBe(200);
    expect(sendRegistrationConfirmation).toHaveBeenCalledWith(
      expect.anything(),
      edition,
      expect.objectContaining({ passType: 'campaign', days: ['day1', 'day2'], amountPaid: 3000 }),
    );
  });
});
