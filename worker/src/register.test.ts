import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('./supabase', () => ({ serviceClient: vi.fn() }));
vi.mock('./bgc-client', () => ({ fetchGuildStatus: vi.fn() }));
vi.mock('./apps-script', () => ({ sendEmail: vi.fn() }));
vi.mock('./editions', () => ({
  getEditionById: vi.fn(),
  getReservedSeatsByDay: vi.fn(),
  dayLabel: (days: string[]) => days.join('+'),
}));

import { serviceClient } from './supabase';
import { fetchGuildStatus } from './bgc-client';
import { sendEmail } from './apps-script';
import { getEditionById, getReservedSeatsByDay } from './editions';
import { handleRegister } from './register';

function mockEnv() {
  return { SUPABASE_URL: 'x', SUPABASE_SERVICE_KEY: 'x', BGC_WORKER_URL: 'x', REPLAY_TO_BGC_SECRET: 'x', APPS_SCRIPT_URL: 'x', APPS_SCRIPT_SECRET: 'x' } as any;
}

function defaultEdition() {
  return {
    id: 'e1',
    slug: 'replay-3',
    name: 'REPLAY 3',
    start_date: '2026-09-12',
    end_date: '2026-09-13',
    daily_start_time: '10:00:00',
    daily_end_time: '19:00:00',
    venue: 'TBD',
    capacity_per_day: { day1: 250, day2: 250 },
    pricing: { oneshot: { day1: 800, day2: 800 }, campaign: 1400, adventurer_cap: 1000 },
    registration_status: 'open' as const,
    is_current: true,
    is_published: true,
  };
}

function mockSupabase(opts: {
  existingUser?: any;
  existingRegs?: Array<{ payment_status: string }>;
  insertedUser?: any;
  insertedReg?: any;
  leadConverted?: boolean;
  capture?: { reg?: any; user?: any; leadUpdate?: any };
}) {
  const cap = opts.capture ?? {};
  return {
    from: (table: string) => {
      if (table === 'users') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: opts.existingUser ?? null, error: null }),
            }),
          }),
          insert: (row: any) => ({
            select: () => ({
              single: async () => {
                cap.user = row;
                return { data: opts.insertedUser ?? { ...row, phone: row.phone }, error: null };
              },
            }),
          }),
          update: (row: any) => ({
            eq: async () => {
              cap.user = row;
              return { error: null };
            },
          }),
        };
      }
      if (table === 'registrations') {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                neq: async () => ({ data: opts.existingRegs ?? [], error: null }),
              }),
            }),
          }),
          insert: (row: any) => ({
            select: () => ({
              single: async () => {
                cap.reg = row;
                return { data: { id: 'reg-1', ...row }, error: null };
              },
            }),
          }),
        };
      }
      if (table === 'leads') {
        return {
          update: (row: any) => ({
            eq: () => ({
              eq: async () => {
                cap.leadUpdate = row;
                return { error: null };
              },
            }),
          }),
        };
      }
      throw new Error('unexpected table ' + table);
    },
  };
}

function validBody(overrides: Partial<any> = {}) {
  return JSON.stringify({
    phone: '9876543210',
    name: 'Asha',
    email: 'a@b.c',
    edition_id: 'e1',
    pass_type: 'oneshot',
    days: ['day1'],
    ...overrides,
  });
}

beforeEach(() => {
  vi.resetAllMocks();
  (getEditionById as any).mockResolvedValue(defaultEdition());
  (getReservedSeatsByDay as any).mockResolvedValue({ day1: 0, day2: 0 });
  (fetchGuildStatus as any).mockResolvedValue({ tier: null, active: false });
  (sendEmail as any).mockResolvedValue(undefined);
});

describe('handleRegister', () => {
  it('rejects invalid phone with 400', async () => {
    (serviceClient as any).mockReturnValue(mockSupabase({}));
    const req = new Request('http://x/api/register', { method: 'POST', body: validBody({ phone: '12' }) });
    const res = await handleRegister(req, mockEnv());
    expect(res.status).toBe(400);
  });

  it('rejects when registration_status != open with 409', async () => {
    (getEditionById as any).mockResolvedValue({ ...defaultEdition(), registration_status: 'upcoming' });
    (serviceClient as any).mockReturnValue(mockSupabase({}));
    const req = new Request('http://x/api/register', { method: 'POST', body: validBody() });
    const res = await handleRegister(req, mockEnv());
    expect(res.status).toBe(409);
    const body: any = await res.json();
    expect(body.error).toBe('registration_closed');
  });

  it('rejects when day capacity exceeded', async () => {
    (getReservedSeatsByDay as any).mockResolvedValue({ day1: 250, day2: 0 });
    (serviceClient as any).mockReturnValue(mockSupabase({}));
    const req = new Request('http://x/api/register', { method: 'POST', body: validBody() });
    const res = await handleRegister(req, mockEnv());
    expect(res.status).toBe(409);
    const body: any = await res.json();
    expect(body).toEqual({ error: 'sold_out', day: 'day1' });
  });

  it('guildmaster gets full discount and confirmed status + email dispatched', async () => {
    (fetchGuildStatus as any).mockResolvedValue({ tier: 'guildmaster', active: true });
    const cap: any = {};
    (serviceClient as any).mockReturnValue(mockSupabase({ existingUser: { phone: '9876543210', name: 'A', email: 'a@b.c' }, capture: cap }));
    const req = new Request('http://x/api/register', { method: 'POST', body: validBody({ pass_type: 'campaign', days: ['day1', 'day2'] }) });
    const res = await handleRegister(req, mockEnv());
    expect(res.status).toBe(200);
    const body: any = await res.json();
    expect(body.final_amount).toBe(0);
    expect(body.discount_applied).toBe(1400);
    expect(body.payment_required).toBe(false);
    expect(cap.reg.payment_status).toBe('confirmed');
    expect(cap.reg.guild_tier_at_purchase).toBe('guildmaster');
    expect(sendEmail).toHaveBeenCalledTimes(1);

    // New payload assertions for Phase 1F.
    const call = (sendEmail as any).mock.calls[0][1];
    expect(call.subject).toBe('REPLAY 3rd edition — registration confirmed');
    expect(call.variables.edition_name).toBe('REPLAY 3rd edition');
    expect(call.variables.date_range).toBe('Sep 12 – Sep 13');
    expect(call.variables.guild_tier).toBe('Guildmaster');
    expect(call.variables.calendar_google_url).toContain('calendar.google.com');
    expect(call.variables.calendar_google_url).toContain('text=REPLAY%203rd%20edition');
    expect(call.variables.calendar_ics_url).toBe('https://api.replaycon.in/api/ics/replay-3.ics');
    expect(call.variables.schedule_url).toBe('https://replaycon.in/schedule');
    expect(call.variables.instagram_url).toBe('https://instagram.com/replaycon');
    expect(call.variables.whatsapp_share_url).toMatch(/^https:\/\/wa\.me\/\?text=/);
  });

  it('adventurer with cap=1000 against campaign 1400 => final=400 + pending status', async () => {
    (fetchGuildStatus as any).mockResolvedValue({ tier: 'adventurer', active: true });
    const cap: any = {};
    (serviceClient as any).mockReturnValue(mockSupabase({ existingUser: { phone: '9876543210', name: 'A', email: 'a@b.c' }, capture: cap }));
    const req = new Request('http://x/api/register', { method: 'POST', body: validBody({ pass_type: 'campaign', days: ['day1', 'day2'] }) });
    const res = await handleRegister(req, mockEnv());
    const body: any = await res.json();
    expect(body.final_amount).toBe(400);
    expect(body.discount_applied).toBe(1000);
    expect(body.payment_required).toBe(true);
    expect(cap.reg.payment_status).toBe('pending');
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it('anti-split: active guild with existing reg => discount_blocked + 0 discount', async () => {
    (fetchGuildStatus as any).mockResolvedValue({ tier: 'guildmaster', active: true });
    const cap: any = {};
    (serviceClient as any).mockReturnValue(mockSupabase({
      existingUser: { phone: '9876543210', name: 'A', email: 'a@b.c' },
      existingRegs: [{ payment_status: 'confirmed' }],
      capture: cap,
    }));
    const req = new Request('http://x/api/register', { method: 'POST', body: validBody({ pass_type: 'campaign', days: ['day1', 'day2'] }) });
    const res = await handleRegister(req, mockEnv());
    const body: any = await res.json();
    expect(body.discount_blocked).toBe(true);
    expect(body.discount_applied).toBe(0);
    expect(body.final_amount).toBe(1400);
    expect(cap.reg.guild_tier_at_purchase).toBeNull();
  });

  it('rejects campaign with single day with 400', async () => {
    (serviceClient as any).mockReturnValue(mockSupabase({}));
    const req = new Request('http://x/api/register', { method: 'POST', body: validBody({ pass_type: 'campaign', days: ['day1'] }) });
    const res = await handleRegister(req, mockEnv());
    expect(res.status).toBe(400);
  });

  it('rejects oneshot with multiple days with 400', async () => {
    (serviceClient as any).mockReturnValue(mockSupabase({}));
    const req = new Request('http://x/api/register', { method: 'POST', body: validBody({ pass_type: 'oneshot', days: ['day1', 'day2'] }) });
    const res = await handleRegister(req, mockEnv());
    expect(res.status).toBe(400);
  });

  it('fills only missing identity fields for a returning user', async () => {
    const cap: any = {};
    (serviceClient as any).mockReturnValue(mockSupabase({
      existingUser: { phone: '9876543210', name: 'Asha', email: null },
      capture: cap,
    }));
    const req = new Request('http://x/api/register', {
      method: 'POST',
      body: validBody({ name: 'Different name', email: 'new@example.com' }),
    });
    const res = await handleRegister(req, mockEnv());
    expect(res.status).toBe(200);
    expect(cap.user).toEqual({ email: 'new@example.com' });
  });

  it('preserves stored identity and emails the stored address', async () => {
    (fetchGuildStatus as any).mockResolvedValue({ tier: 'guildmaster', active: true });
    const cap: any = {};
    (serviceClient as any).mockReturnValue(mockSupabase({
      existingUser: { phone: '9876543210', name: 'Asha', email: 'asha@example.com' },
      capture: cap,
    }));
    const req = new Request('http://x/api/register', {
      method: 'POST',
      body: validBody({ name: 'Different name', email: 'other@example.com' }),
    });
    const res = await handleRegister(req, mockEnv());
    expect(res.status).toBe(200);
    expect(cap.user).toBeUndefined();
    const emailPayload = (sendEmail as any).mock.calls[0][1];
    expect(emailPayload.to).toBe('asha@example.com');
    expect(emailPayload.variables.name).toBe('Asha');
  });
});
