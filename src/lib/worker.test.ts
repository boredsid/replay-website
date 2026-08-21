import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { lookupPhone, getEditionSpots, previewRegistration, registerForEdition, captureLead, cancelRegistration } from './worker';

const WORKER_URL = 'https://api.replaycon.in';

beforeEach(() => {
  vi.stubEnv('PUBLIC_WORKER_URL', WORKER_URL);
  vi.spyOn(global, 'fetch');
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

function mockFetch(status: number, body: unknown) {
  (global.fetch as any).mockResolvedValue(new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }));
}

describe('lookupPhone', () => {
  it('POSTs to /api/lookup-phone with phone + edition_id', async () => {
    mockFetch(200, { user: { found: false, name: null, email: null }, guild: { tier: null, active: false }, existing_for_edition: { count: 0, has_confirmed: false }, discount_blocked: false });
    const out = await lookupPhone('9876543210', 'e1');
    expect(out.user.found).toBe(false);
    expect(global.fetch).toHaveBeenCalledWith(`${WORKER_URL}/api/lookup-phone`, expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ phone: '9876543210', edition_id: 'e1' }),
    }));
  });

  it('throws on non-2xx', async () => {
    mockFetch(400, { error: 'invalid phone' });
    await expect(lookupPhone('x', 'e1')).rejects.toThrow();
  });
});

describe('getEditionSpots', () => {
  it('GETs /api/edition-spots/:id', async () => {
    mockFetch(200, { day1: { capacity: 250, remaining: 250, sold_out: false }, day2: { capacity: 250, remaining: 250, sold_out: false }, both_sold_out: false });
    const out = await getEditionSpots('e1');
    expect(out.day1.remaining).toBe(250);
    expect(global.fetch).toHaveBeenCalledWith(`${WORKER_URL}/api/edition-spots/e1`);
  });
});

describe('registerForEdition', () => {
  it('POSTs to /api/register', async () => {
    mockFetch(200, { registration_id: 'r1', final_amount: 0, discount_applied: 800, discount_blocked: false, payment_required: false });
    const out = await registerForEdition({
      phone: '9876543210', name: 'A', email: 'a@b.c', edition_id: 'e1', pass_type: 'oneshot', days: ['day1'], quantity: 3,
    });
    expect(out.registration_id).toBe('r1');
    expect(global.fetch).toHaveBeenCalledWith(`${WORKER_URL}/api/register`, expect.objectContaining({
      body: expect.stringContaining('"quantity":3'),
    }));
  });
});

describe('previewRegistration', () => {
  it('POSTs registration details to /api/register/preview', async () => {
    mockFetch(200, {
      payment_reference: '123e4567-e89b-42d3-a456-426614174000',
      final_amount: 800,
      discount_applied: 0,
      discount_blocked: false,
      payment_required: true,
    });
    const input = {
      phone: '9876543210', name: 'A', email: 'a@b.c', edition_id: 'e1', pass_type: 'oneshot' as const, days: ['day1' as const], quantity: 1,
    };
    const out = await previewRegistration(input);
    expect(out.payment_reference).toBe('123e4567-e89b-42d3-a456-426614174000');
    expect(global.fetch).toHaveBeenCalledWith(`${WORKER_URL}/api/register/preview`, expect.objectContaining({
      method: 'POST',
      body: JSON.stringify(input),
    }));
  });
});

describe('captureLead', () => {
  it('POSTs to /api/lead and ignores errors quietly', async () => {
    mockFetch(200, { ok: true });
    await expect(captureLead('9876543210', 'e1', 'phone_entered')).resolves.toEqual({ ok: true });
  });
  it('does NOT throw on non-2xx (fire-and-forget)', async () => {
    mockFetch(500, { error: 'oops' });
    await expect(captureLead('9876543210', 'e1', 'phone_entered')).resolves.toBeUndefined();
  });
});

describe('cancelRegistration', () => {
  it('POSTs to /api/cancel-registration', async () => {
    mockFetch(200, { ok: true, registration_id: 'r1' });
    const out = await cancelRegistration('r1', '9876543210');
    expect(out.ok).toBe(true);
  });
});
