import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./supabase', () => ({ serviceClient: vi.fn() }));
vi.mock('./editions', () => ({ getEditionById: vi.fn() }));

import { serviceClient } from './supabase';
import { getEditionById } from './editions';
import {
  generateInviteToken,
  handlePartnerInviteGet,
  handlePartnerInvitePaymentClaimed,
  handlePartnerInviteSubmit,
  inviteUrl,
} from './partner-invite';

const TOKEN = 'a1b2c3d4e5f6a7b8c9d0e1f2';
const edition = {
  id: 'e1', slug: 'replay-3', name: 'REPLAY', start_date: '2026-09-12', end_date: '2026-09-13',
  daily_start_time: '10:00:00', daily_end_time: '19:00:00', venue: 'IndiQube Symphony',
  capacity_per_day: { day1: 250, day2: 250 }, pricing: {},
  partner_pricing: { gst_rate: 0.18, standard_booth: 8000, community_booth: 6500, standard_engagement: 3000, patron_engagement: 3500 },
  registration_status: 'open', is_current: true, is_published: true,
};

function lead(overrides: Record<string, unknown> = {}) {
  return {
    id: 'p1',
    edition_id: 'e1',
    organization_name: 'Meeple Mart',
    contact_name: null,
    phone: null,
    email: null,
    website_url: null,
    gstin: null,
    kind: 'sponsorship',
    package_key: 'zone_sponsor',
    days: ['day1', 'day2'],
    details: null,
    internal_notes: 'Introduced by Asha, wants the RPG zone',
    base_amount: 15000,
    gst_amount: 2700,
    total_amount: 17700,
    payment_status: 'pending',
    stage: 'lead',
    invite_token: TOKEN,
    invite_expires_at: null,
    submitted_at: null,
    payment_claimed_at: null,
    ...overrides,
  };
}

/** Mirrors the generated `stage` column so the mocked update reads back true. */
function withStage(row: any) {
  const stage = row.payment_status === 'cancelled'
    ? 'cancelled'
    : row.payment_status === 'confirmed'
      ? 'confirmed'
      : row.submitted_at
        ? 'prospective'
        : 'lead';
  return { ...row, stage };
}

function mockDatabase(existing: any) {
  let updated: any;
  (serviceClient as any).mockReturnValue({
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: existing, error: null }) }) }),
      update: (patch: any) => {
        updated = patch;
        return {
          eq: () => ({
            select: () => ({ single: async () => ({ data: withStage({ ...existing, ...patch }), error: null }) }),
          }),
        };
      },
    }),
  });
  return () => updated;
}

function submitRequest(body: Record<string, unknown> = {}) {
  return new Request(`https://api.x/api/partner-invite/${TOKEN}`, {
    method: 'POST',
    body: JSON.stringify({
      contact_name: 'Nikhil',
      phone: '9876543210',
      email: 'Nikhil@Meeple.example',
      details: 'We will run the RPG zone with four tables.',
      ...body,
    }),
  });
}

beforeEach(() => {
  vi.resetAllMocks();
  (getEditionById as any).mockResolvedValue(edition);
});

describe('partner invite link', () => {
  it('builds a link on the public site, not the API host', () => {
    expect(inviteUrl({ REPLAY_SITE_URL: 'https://replaycon.in/' } as any, TOKEN))
      .toBe(`https://replaycon.in/partner/?t=${TOKEN}`);
  });

  it('generates tokens the token format check accepts', () => {
    const token = generateInviteToken();
    expect(token).toMatch(/^[a-z0-9]{24,64}$/);
    expect(token).not.toBe(generateInviteToken());
  });

  it('shows the partner the offer and price without internal notes', async () => {
    mockDatabase(lead());
    const res = await handlePartnerInviteGet(new Request(`https://api.x/api/partner-invite/${TOKEN}`), {} as any, TOKEN);
    const body: any = await res.json();

    expect(res.status).toBe(200);
    expect(body.invite).toMatchObject({
      organization_name: 'Meeple Mart',
      offer_key: 'zone_sponsor',
      offer_label: 'Zone partner',
      kind: 'sponsorship',
      days_rule: 'weekend',
      stage: 'lead',
      total_amount: 17700,
      payment_required: true,
      payment_claimed: false,
    });
    expect(body.invite.edition).toMatchObject({ name: 'REPLAY 3rd edition', venue: 'IndiQube Symphony' });
    expect(JSON.stringify(body)).not.toContain('Introduced by Asha');
  });

  it('404s an unknown token and 410s an expired one', async () => {
    mockDatabase(null);
    const missing = await handlePartnerInviteGet(new Request('https://api.x/'), {} as any, TOKEN);
    expect(missing.status).toBe(404);

    mockDatabase(lead({ invite_expires_at: '2020-01-01T00:00:00Z' }));
    const stale = await handlePartnerInviteGet(new Request('https://api.x/'), {} as any, TOKEN);
    expect(stale.status).toBe(410);
    expect(await stale.json()).toEqual({ error: 'invite_expired' });
  });

  it('makes a lead prospective when the form is filled, keeping the agreed price', async () => {
    const updated = mockDatabase(lead());
    const res = await handlePartnerInviteSubmit(
      submitRequest({ base_amount: 1, gst_amount: 0, website_url: 'https://meeple.example' }),
      {} as any,
      TOKEN,
    );
    const body: any = await res.json();

    expect(res.status).toBe(200);
    expect(updated()).toMatchObject({
      contact_name: 'Nikhil',
      phone: '9876543210',
      email: 'nikhil@meeple.example',
      website_url: 'https://meeple.example/',
      days: ['day1', 'day2'],
    });
    expect(updated().submitted_at).toEqual(expect.any(String));
    expect(updated().base_amount).toBeUndefined();
    expect(body.invite).toMatchObject({ stage: 'prospective', total_amount: 17700 });
  });

  it('asks a single-day offer for its day and takes the partner’s choice', async () => {
    const engagement = lead({ package_key: 'standard_engagement', kind: 'community_engagement', days: [], base_amount: 3000, gst_amount: 540, total_amount: 3540 });

    mockDatabase(engagement);
    const missingDay = await handlePartnerInviteSubmit(submitRequest(), {} as any, TOKEN);
    expect(missingDay.status).toBe(400);
    expect(await missingDay.json()).toEqual({ error: 'invalid_days' });

    const updated = mockDatabase(engagement);
    const res = await handlePartnerInviteSubmit(submitRequest({ day: 'day2' }), {} as any, TOKEN);
    expect(res.status).toBe(200);
    expect(updated().days).toEqual(['day2']);
  });

  it('refuses a link that is already confirmed or cancelled', async () => {
    mockDatabase(lead({ payment_status: 'confirmed', stage: 'confirmed', submitted_at: '2026-08-01T00:00:00Z', contact_name: 'Nikhil', phone: '9876543210', email: 'n@x.example' }));
    const confirmed = await handlePartnerInviteSubmit(submitRequest(), {} as any, TOKEN);
    expect(confirmed.status).toBe(409);
    expect(await confirmed.json()).toEqual({ error: 'invite_already_confirmed' });

    mockDatabase(lead({ payment_status: 'cancelled', stage: 'cancelled' }));
    const cancelled = await handlePartnerInviteSubmit(submitRequest(), {} as any, TOKEN);
    expect(cancelled.status).toBe(409);
  });

  it('records a claimed payment but leaves the money unverified', async () => {
    const submitted = lead({
      stage: 'prospective', submitted_at: '2026-08-20T10:00:00Z',
      contact_name: 'Nikhil', phone: '9876543210', email: 'nikhil@meeple.example',
      details: 'RPG zone',
    });
    const updated = mockDatabase(submitted);
    const res = await handlePartnerInvitePaymentClaimed(new Request('https://api.x/', { method: 'POST' }), {} as any, TOKEN);
    const body: any = await res.json();

    expect(res.status).toBe(200);
    expect(updated()).toEqual({ payment_claimed_at: expect.any(String) });
    expect(body.invite).toMatchObject({ stage: 'prospective', payment_claimed: true });
  });

  it('will not accept a payment claim before the form is filled', async () => {
    mockDatabase(lead());
    const res = await handlePartnerInvitePaymentClaimed(new Request('https://api.x/', { method: 'POST' }), {} as any, TOKEN);
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: 'invite_not_submitted' });
  });
});
