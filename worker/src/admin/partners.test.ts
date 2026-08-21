import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../partner-email', () => ({ sendPartnerConfirmation: vi.fn(async () => {}) }));
import { sendPartnerConfirmation } from '../partner-email';
import { handlePartnerCreate, handlePartnerPatch } from './partners';

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
