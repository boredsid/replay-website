import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../partner-email', () => ({ sendPartnerConfirmation: vi.fn(async () => {}) }));
import { sendPartnerConfirmation } from '../partner-email';
import { handlePartnerCreate, handlePartnerInviteCreate, handlePartnerPatch } from './partners';

const ORIGIN = 'https://admin.replaycon.in';
const edition = {
  id: 'e1', slug: 'replay-3', name: 'REPLAY', start_date: '2026-09-12', end_date: '2026-09-13',
  daily_start_time: '10:00:00', daily_end_time: '19:00:00', venue: 'TBD',
  capacity_per_day: { day1: 250, day2: 250 }, pricing: {},
  partner_pricing: { gst_rate: 0.18, standard_booth: 8000, community_booth: 6500, standard_engagement: 3000, patron_engagement: 3500 },
  registration_status: 'open', is_current: true, is_published: true,
};

const valid = {
  edition_id: 'e1', organization_name: 'Tabletop Club', contact_name: 'Asha', phone: '9876543210',
  email: 'asha@example.com', package_key: 'standard_engagement', days: ['day1'], details: 'A workshop', payment_status: 'pending',
};

beforeEach(() => vi.resetAllMocks());

describe('partner admin handlers', () => {
  it('adds a partner with canonical pricing and an audit row', async () => {
    let inserted: any;
    let audit: any;
    const sb: any = {
      from: (table: string) => {
        if (table === 'editions') return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: edition, error: null }) }) }) };
        if (table === 'partners') return { insert: (row: any) => { inserted = row; return { select: () => ({ single: async () => ({ data: { id: 'p1', ...row, total_amount: row.base_amount + row.gst_amount }, error: null }) }) }; } };
        if (table === 'admin_audit_log') return { insert: async (row: any) => { audit = row; return { error: null }; } };
        throw new Error(`unexpected ${table}`);
      },
    };
    const req = new Request('https://api.x/api/admin/partners', { method: 'POST', body: JSON.stringify(valid) });
    const res = await handlePartnerCreate(req, {} as any, sb, 'sid@example.com', ORIGIN);
    expect(res.status).toBe(200);
    expect(inserted).toMatchObject({ kind: 'community_engagement', base_amount: 3000, gst_amount: 540 });
    expect(audit.action).toBe('partner.create');
  });

  it('emails the contact when a pending partner becomes confirmed', async () => {
    const before = { id: 'p1', ...valid, kind: 'community_engagement', website_url: null, gstin: null, internal_notes: null, base_amount: 3000, gst_amount: 540, total_amount: 3540 };
    let audit: any;
    const sb: any = {
      from: (table: string) => {
        if (table === 'partners') return {
          select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: before, error: null }) }) }),
          update: (row: any) => ({ eq: () => ({ select: () => ({ single: async () => ({ data: { ...before, ...row, total_amount: row.base_amount + row.gst_amount }, error: null }) }) }) }),
        };
        if (table === 'editions') return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: edition, error: null }) }) }) };
        if (table === 'admin_audit_log') return { insert: async (row: any) => { audit = row; return { error: null }; } };
        throw new Error(`unexpected ${table}`);
      },
    };
    const req = new Request('https://api.x/api/admin/partners/p1', { method: 'PATCH', body: JSON.stringify({ payment_status: 'confirmed' }) });
    const res = await handlePartnerPatch(req, {} as any, sb, 'p1', 'sid@example.com', ORIGIN);
    const body: any = await res.json();
    expect(res.status).toBe(200);
    expect(body.email_sent).toBe(true);
    expect(sendPartnerConfirmation).toHaveBeenCalledTimes(1);
    expect(audit.action).toBe('partner.update');
  });
});

describe('partner invite links', () => {
  const env = { REPLAY_SITE_URL: 'https://replaycon.in' } as any;

  function db(existing?: any) {
    const captured: { inserted?: any; updated?: any; audit?: any } = {};
    const sb: any = {
      from: (table: string) => {
        if (table === 'editions') return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: edition, error: null }) }) }) };
        if (table === 'partners') return {
          select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: existing, error: null }) }) }),
          insert: (row: any) => { captured.inserted = row; return { select: () => ({ single: async () => ({ data: { id: 'p1', ...row }, error: null }) }) }; },
          update: (row: any) => { captured.updated = row; return { eq: () => ({ select: () => ({ single: async () => ({ data: { ...existing, ...row }, error: null }) }) }) }; },
        };
        if (table === 'admin_audit_log') return { insert: async (row: any) => { captured.audit = row; return { error: null }; } };
        throw new Error(`unexpected ${table}`);
      },
    };
    return { sb, captured };
  }

  it('creates a lead carrying only the name, the offer and the price', async () => {
    const { sb, captured } = db();
    const req = new Request('https://api.x/api/admin/partners/invites', { method: 'POST', body: JSON.stringify({
      edition_id: 'e1', organization_name: 'Meeple Mart', package_key: 'zone_sponsor', base_amount: 15000,
      internal_notes: 'Wants the RPG zone',
    }) });
    const res = await handlePartnerInviteCreate(req, env, sb, 'sid@example.com', ORIGIN);
    const body: any = await res.json();

    expect(res.status).toBe(200);
    expect(captured.inserted).toMatchObject({
      organization_name: 'Meeple Mart',
      kind: 'sponsorship',
      package_key: 'zone_sponsor',
      days: ['day1', 'day2'],
      base_amount: 15000,
      gst_amount: 2700,
      contact_name: null,
      submitted_at: null,
      payment_status: 'pending',
      invite_created_by: 'sid@example.com',
    });
    expect(body.invite_url).toBe(`https://replaycon.in/partner/?t=${captured.inserted.invite_token}`);
    expect(captured.audit.action).toBe('partner.invite');
    expect(captured.audit.diff.invite_token).toBe('[redacted]');
  });

  it('prices a self-serve package from the edition when no amount is given', async () => {
    const { sb, captured } = db();
    const req = new Request('https://api.x/api/admin/partners/invites', { method: 'POST', body: JSON.stringify({
      edition_id: 'e1', organization_name: 'Dice Cafe', package_key: 'standard_engagement', day: 'day2',
    }) });
    const res = await handlePartnerInviteCreate(req, env, sb, 'sid@example.com', ORIGIN);

    expect(res.status).toBe(200);
    expect(captured.inserted).toMatchObject({ base_amount: 3000, gst_amount: 540, days: ['day2'] });
  });

  it('needs an amount for a negotiated sponsorship', async () => {
    const { sb } = db();
    const req = new Request('https://api.x/api/admin/partners/invites', { method: 'POST', body: JSON.stringify({
      edition_id: 'e1', organization_name: 'Meeple Mart', package_key: 'title_sponsor',
    }) });
    const res = await handlePartnerInviteCreate(req, env, sb, 'sid@example.com', ORIGIN);

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'invalid_base_amount' });
  });

  it('promotes a lead an admin fills in by hand to prospective', async () => {
    const existing = {
      id: 'p1', edition_id: 'e1', organization_name: 'Meeple Mart', contact_name: null, phone: null, email: null,
      website_url: null, gstin: null, kind: 'sponsorship', package_key: 'zone_sponsor', days: ['day1', 'day2'],
      details: null, internal_notes: null, base_amount: 15000, gst_amount: 2700, total_amount: 17700,
      payment_status: 'pending', submitted_at: null,
    };
    const { sb, captured } = db(existing);
    const req = new Request('https://api.x/api/admin/partners/p1', { method: 'PATCH', body: JSON.stringify({
      contact_name: 'Nikhil', phone: '9876543210', email: 'nikhil@meeple.example',
    }) });
    const res = await handlePartnerPatch(req, {} as any, sb, 'p1', 'sid@example.com', ORIGIN);

    expect(res.status).toBe(200);
    expect(captured.updated).toMatchObject({ contact_name: 'Nikhil', phone: '9876543210' });
    expect(captured.updated.submitted_at).toEqual(expect.any(String));
  });

  it('leaves a still-empty lead alone on edit', async () => {
    const existing = {
      id: 'p1', edition_id: 'e1', organization_name: 'Meeple Mart', contact_name: null, phone: null, email: null,
      website_url: null, gstin: null, kind: 'sponsorship', package_key: 'zone_sponsor', days: ['day1', 'day2'],
      details: null, internal_notes: null, base_amount: 15000, gst_amount: 2700, total_amount: 17700,
      payment_status: 'pending', submitted_at: null,
    };
    const { sb, captured } = db(existing);
    const req = new Request('https://api.x/api/admin/partners/p1', { method: 'PATCH', body: JSON.stringify({ base_amount: 12000 }) });
    const res = await handlePartnerPatch(req, {} as any, sb, 'p1', 'sid@example.com', ORIGIN);

    expect(res.status).toBe(200);
    expect(captured.updated.base_amount).toBe(12000);
    expect(captured.updated.submitted_at).toBeUndefined();
    expect(sendPartnerConfirmation).not.toHaveBeenCalled();
  });
});
