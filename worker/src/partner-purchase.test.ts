import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./supabase', () => ({ serviceClient: vi.fn() }));
vi.mock('./editions', () => ({ getEditionById: vi.fn() }));

import { serviceClient } from './supabase';
import { getEditionById } from './editions';
import { handlePartnerPurchase, handlePartnerPurchasePreview } from './partner-purchase';

const PARTNER_ID = '11111111-1111-4111-8111-111111111111';
const edition = {
  id: 'e1', slug: 'replay-3', name: 'REPLAY', start_date: '2027-01-10', end_date: '2027-01-11',
  daily_start_time: '10:00:00', daily_end_time: '19:00:00', venue: 'TBD',
  capacity_per_day: { day1: 250, day2: 250 }, pricing: {},
  partner_pricing: { gst_rate: 0.18, standard_booth: 8000, community_booth: 6500, standard_engagement: 3000, patron_engagement: 3500 },
  registration_status: 'upcoming', is_current: true, is_published: true,
};

function request(overrides: Record<string, unknown> = {}, path = '/api/partner-purchase') {
  return new Request(`https://api.x${path}`, { method: 'POST', body: JSON.stringify({
    edition_id: 'e1', organization_name: 'Tabletop Club', contact_name: 'Asha', phone: '9876543210',
    email: 'asha@example.com', package_key: 'standard_booth', days: ['day1', 'day2'], details: 'A games booth',
    ...overrides,
  }) });
}

function mockDatabase(existing: any = null) {
  let inserted: any;
  (serviceClient as any).mockReturnValue({
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: existing, error: null }) }) }),
      insert: (row: any) => {
        inserted = row;
        return {
          select: () => ({
            single: async () => ({
              data: { ...row, total_amount: row.base_amount + row.gst_amount },
              error: null,
            }),
          }),
        };
      },
    }),
  });
  return () => inserted;
}

beforeEach(() => {
  vi.resetAllMocks();
  (getEditionById as any).mockResolvedValue(edition);
});

describe('partner purchase payment flow', () => {
  it('previews server-side pricing without creating a partner row', async () => {
    const response = await handlePartnerPurchasePreview(request({}, '/api/partner-purchase/preview'), {} as any);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      base_amount: 8000,
      gst_amount: 1440,
      final_amount: 9440,
      payment_required: true,
    });
    expect(serviceClient).not.toHaveBeenCalled();
  });

  it('creates the pending partner only after the buyer claims payment', async () => {
    const inserted = mockDatabase();
    const response = await handlePartnerPurchase(request({
      partner_id: PARTNER_ID,
      expected_amount: 9440,
    }), {} as any);

    expect(response.status).toBe(200);
    expect(inserted()).toMatchObject({
      id: PARTNER_ID,
      kind: 'booth',
      base_amount: 8000,
      gst_amount: 1440,
      payment_status: 'pending',
    });
    expect(await response.json()).toMatchObject({ partner_id: PARTNER_ID, final_amount: 9440 });
  });

  it('rejects a booth that does not cover both days', async () => {
    const response = await handlePartnerPurchasePreview(request({ days: ['day1'] }, '/api/partner-purchase/preview'), {} as any);
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'invalid_days' });
  });

  it('rejects a changed amount before inserting', async () => {
    const inserted = mockDatabase();
    const response = await handlePartnerPurchase(request({
      partner_id: PARTNER_ID,
      expected_amount: 9000,
    }), {} as any);
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: 'amount_changed', final_amount: 9440 });
    expect(inserted()).toBeUndefined();
  });

  it('returns an idempotent response for the same payment reference', async () => {
    mockDatabase({
      id: PARTNER_ID,
      edition_id: 'e1',
      organization_name: 'Tabletop Club',
      contact_name: 'Asha',
      phone: '9876543210',
      email: 'asha@example.com',
      website_url: null,
      gstin: null,
      package_key: 'standard_booth',
      days: ['day1', 'day2'],
      details: 'A games booth',
      base_amount: 8000,
      gst_amount: 1440,
      total_amount: 9440,
      payment_status: 'pending',
    });
    const response = await handlePartnerPurchase(request({
      partner_id: PARTNER_ID,
      expected_amount: 9440,
    }), {} as any);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ partner_id: PARTNER_ID, final_amount: 9440 });
  });

  it('fails closed when the requested edition is not current', async () => {
    (getEditionById as any).mockResolvedValue({ ...edition, is_current: false });
    const response = await handlePartnerPurchasePreview(request({}, '/api/partner-purchase/preview'), {} as any);
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: 'partner_sales_closed' });
  });
});
