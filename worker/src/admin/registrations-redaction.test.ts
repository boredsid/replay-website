import { describe, it, expect, vi } from 'vitest';

const edition = { id: 'ed-1', slug: 'replay-3' };
vi.mock('../editions', () => ({
  getCurrentEdition: vi.fn(async () => ({ id: 'ed-1', slug: 'replay-3' })),
  getEditionBySlug: vi.fn(async () => ({ id: 'ed-1', slug: 'replay-3' })),
}));

import { handleRegList, handleRegGet } from './registrations';

const ORIGIN = 'https://admin.replaycon.in';
const env = {} as never;

const ROW = {
  id: 'reg-1',
  user_phone: '9982200768',
  pass_type: 'campaign',
  days: ['day1', 'day2'],
  seats: 2,
  amount_paid: 2400,
  discount_applied: 300,
  promo_code: 'EARLY',
  promo_discount: 200,
  payment_status: 'confirmed',
  created_at: '2026-08-01T00:00:00Z',
  users: { name: 'Siddhant Narula' },
};

function listClient() {
  return {
    from: () => ({
      select: () => ({
        eq: () => ({ order: async () => ({ data: [ROW], error: null }) }),
      }),
    }),
  } as never;
}

function getClient() {
  return {
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: ROW, error: null }) }) }),
    }),
  } as never;
}

const listRequest = () => new Request('https://api/api/admin/registrations?edition=replay-3');

describe('what a read-only viewer gets', () => {
  it('shows no money at all', async () => {
    // Every money field, not only amount_paid: leaving the discount would let
    // the price be worked out from it, which makes the redaction decorative.
    const body = await (await handleRegList(listRequest(), env, listClient(), ORIGIN, true)).json() as
      { registrations: Array<Record<string, unknown>> };
    const row = body.registrations[0];
    expect(row).not.toHaveProperty('amount_paid');
    expect(row).not.toHaveProperty('discount_applied');
    expect(row).not.toHaveProperty('promo_discount');
  });

  it('shows only the last four digits of a number', async () => {
    const body = await (await handleRegList(listRequest(), env, listClient(), ORIGIN, true)).json() as
      { registrations: Array<{ user_phone: string }> };
    expect(body.registrations[0].user_phone).toBe('••••0768');
    expect(JSON.stringify(body)).not.toContain('9982200768');
  });

  it('keeps everything needed to find the right person', async () => {
    // Redaction that removes the answer is not a compromise, it is a broken
    // page: the desk still has to identify who bought what.
    const body = await (await handleRegList(listRequest(), env, listClient(), ORIGIN, true)).json() as
      { registrations: Array<Record<string, unknown>> };
    const row = body.registrations[0];
    expect(row.pass_type).toBe('campaign');
    expect(row.seats).toBe(2);
    expect(row.payment_status).toBe('confirmed');
    expect(row.users).toEqual({ name: 'Siddhant Narula' });
  });

  it('says it is redacted, so the screen can say so too', async () => {
    const body = await (await handleRegList(listRequest(), env, listClient(), ORIGIN, true)).json() as
      { redacted: boolean };
    expect(body.redacted).toBe(true);
  });

  it('redacts a single booking the same way', async () => {
    const body = await (await handleRegGet(env, getClient(), 'reg-1', ORIGIN, true)).json() as
      { registration: Record<string, unknown>; redacted: boolean };
    expect(body.registration).not.toHaveProperty('amount_paid');
    expect(body.registration.user_phone).toBe('••••0768');
    expect(body.redacted).toBe(true);
  });
});

describe('what somebody with full access gets', () => {
  it('is unchanged', async () => {
    const body = await (await handleRegList(listRequest(), env, listClient(), ORIGIN, false)).json() as
      { registrations: Array<Record<string, unknown>>; redacted: boolean };
    const row = body.registrations[0];
    expect(row.amount_paid).toBe(2400);
    expect(row.discount_applied).toBe(300);
    expect(row.user_phone).toBe('9982200768');
    expect(body.redacted).toBe(false);
  });

  it('defaults to unredacted, so a caller must ask for it', async () => {
    // The gate decides; a handler that redacted by default would silently hide
    // data from an admin the first time somebody forgot the argument.
    const body = await (await handleRegList(listRequest(), env, listClient(), ORIGIN)).json() as
      { registrations: Array<Record<string, unknown>> };
    expect(body.registrations[0].amount_paid).toBe(2400);
  });
});
