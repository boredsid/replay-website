import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RegisterForm, type RegisterFormProps } from './RegisterForm';
import type { EditionRow } from '../lib/types';

const EDITION: EditionRow = {
  id: 'e1', slug: 'replay-3', name: 'REPLAY 3',
  start_date: '2026-09-12', end_date: '2026-09-13', venue: 'TBD',
  daily_start_time: '10:00:00', daily_end_time: '19:00:00',
  capacity_per_day: { day1: 250, day2: 250 },
  pricing: { oneshot: 700, campaign: 1200, adventurer_cap: 1000 },
  partner_pricing: { gst_rate: 0.18, standard_booth: 8000, community_booth: 6500, standard_engagement: 3000, patron_engagement: 3500 },
  registration_status: 'open', is_current: true, is_published: true,
};

function buildProps(overrides: Partial<RegisterFormProps> = {}): RegisterFormProps {
  return { edition: EDITION, upiId: 'test@upi', ...overrides };
}

beforeEach(() => {
  vi.stubEnv('PUBLIC_WORKER_URL', 'https://api.replaycon.in');
  vi.stubEnv('PUBLIC_UPI_ID', 'test@upi');
  vi.spyOn(global, 'fetch');
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

function mockRoute(matcher: (url: string, init?: RequestInit) => boolean, status: number, body: unknown) {
  const old = (global.fetch as any).getMockImplementation?.();
  (global.fetch as any).mockImplementation(async (url: string, init?: RequestInit) => {
    if (matcher(url, init)) return new Response(JSON.stringify(body), { status });
    if (old) return old(url, init);
    return new Response('{}', { status: 200 });
  });
}

describe('RegisterForm', () => {

  const OPEN_SPOTS = {
    day1: { capacity: 250, remaining: 250, sold_out: false },
    day2: { capacity: 250, remaining: 250, sold_out: false },
    both_sold_out: false,
  };

  /** Availability plus an applicable code, the setup every promo case needs. */
  function mockPromo(body: unknown, status = 200) {
    mockRoute((u) => u.includes('/api/edition-spots/'), 200, OPEN_SPOTS);
    mockRoute((u) => u.includes('/api/promo/preview'), status, body);
  }

  const SAVE20 = {
    code: 'SAVE20',
    message: 'Early bird unlocked — 20% off your whole order.',
    discount: 140,
    rule: { discount_type: 'percent', discount_value: 20, max_discount: null, scope: 'booking', pass_type: null },
  };

  async function pickSaturday(user: ReturnType<typeof userEvent.setup>) {
    await user.click(await screen.findByLabelText(/saturday/i));
  }

  it('applies a promo code and shows the admin-authored message', async () => {
    mockPromo(SAVE20);
    const user = userEvent.setup();
    render(<RegisterForm {...buildProps()} />);
    await pickSaturday(user);

    await user.type(screen.getByLabelText(/promo code/i), 'save20');
    await user.click(screen.getByRole('button', { name: /^apply$/i }));

    expect(await screen.findByText(/SAVE20 applied/)).toBeInTheDocument();
    expect(screen.getByText('Early bird unlocked — 20% off your whole order.')).toBeInTheDocument();
    expect(screen.getByText(/Promo SAVE20/)).toBeInTheDocument();
    expect(screen.getByText('−₹140')).toBeInTheDocument();
    expect(screen.getByText('₹560')).toBeInTheDocument();
  });

  it('re-prices an applied code when the ticket quantity changes', async () => {
    mockPromo(SAVE20);
    const user = userEvent.setup();
    render(<RegisterForm {...buildProps()} />);
    await pickSaturday(user);
    await user.type(screen.getByLabelText(/promo code/i), 'SAVE20');
    await user.click(screen.getByRole('button', { name: /^apply$/i }));
    await screen.findByText(/SAVE20 applied/);

    await user.click(screen.getByRole('button', { name: /increase ticket quantity/i }));

    // 20% of two ₹700 tickets, without asking the Worker again.
    expect(screen.getByText('−₹280')).toBeInTheDocument();
    expect(screen.getByText('₹1120')).toBeInTheDocument();
  });

  it('keeps the larger Guild Path benefit and says the two do not stack', async () => {
    mockPromo({
      ...SAVE20,
      code: 'SMALL',
      message: '₹50 off, with our thanks.',
      discount: 50,
      rule: { discount_type: 'flat', discount_value: 50, max_discount: null, scope: 'booking', pass_type: null },
    });
    mockRoute((u) => u.includes('/api/lookup-phone'), 200, {
      user: { found: true, name: 'Asha', email: 'a@b.c' },
      guild: { tier: 'guildmaster', active: true },
      existing_for_edition: { count: 0, has_confirmed: false },
      discount_blocked: false,
    });
    const user = userEvent.setup();
    render(<RegisterForm {...buildProps()} />);
    await pickSaturday(user);
    await user.type(screen.getByLabelText(/^phone$/i), '9876543210');
    await screen.findByText(/Guildmaster/i);

    await user.type(screen.getByLabelText(/promo code/i), 'SMALL');
    await user.click(screen.getByRole('button', { name: /^apply$/i }));
    await screen.findByText(/SMALL applied/);

    expect(screen.getByText(/Guild Path benefit saves you more/i)).toBeInTheDocument();
    expect(screen.getByText(/Guild Path \(first ticket\)/)).toBeInTheDocument();
    expect(screen.getByText('−₹700')).toBeInTheDocument();
    expect(screen.getByText('₹0')).toBeInTheDocument();
  });

  it('explains a refused code without blocking the rest of the form', async () => {
    mockPromo({ error: 'promo_expired' }, 404);
    const user = userEvent.setup();
    render(<RegisterForm {...buildProps()} />);
    await pickSaturday(user);

    await user.type(screen.getByLabelText(/promo code/i), 'OLDCODE');
    await user.click(screen.getByRole('button', { name: /^apply$/i }));

    expect(await screen.findByText('That code has expired.')).toBeInTheDocument();
    expect(screen.queryByText(/applied/)).not.toBeInTheDocument();
    expect(screen.getAllByText('₹700')).toHaveLength(2); // subtotal and total, undiscounted
    expect(screen.getByRole('button', { name: /continue with 1 ticket/i })).toBeEnabled();
  });

  it('drops a 2-day-only code when the attendee switches to a 1-day pass', async () => {
    mockPromo({
      ...SAVE20,
      code: 'WEEKEND',
      message: 'Weekend deal applied.',
      discount: 240,
      rule: { discount_type: 'percent', discount_value: 20, max_discount: null, scope: 'booking', pass_type: 'campaign' },
    });
    const user = userEvent.setup();
    render(<RegisterForm {...buildProps()} />);
    await user.click(await screen.findByLabelText(/2-day pass/i));

    await user.type(screen.getByLabelText(/promo code/i), 'WEEKEND');
    await user.click(screen.getByRole('button', { name: /^apply$/i }));
    await screen.findByText(/WEEKEND applied/);
    expect(screen.getByText('−₹240')).toBeInTheDocument();

    await user.click(screen.getByLabelText(/1-day pass/i));

    expect(await screen.findByText(/doesn't apply to the pass you've chosen/i)).toBeInTheDocument();
    expect(screen.queryByText(/WEEKEND applied/)).not.toBeInTheDocument();

    // Switching back to a 1-day pass leaves no day chosen, so either pill works.
    expect(screen.getByLabelText(/saturday/i)).not.toBeChecked();
    expect(screen.getByLabelText(/sunday/i)).not.toBeChecked();
    await user.click(screen.getByLabelText(/sunday/i));
    expect(screen.getAllByText('₹700')).toHaveLength(2); // full price, no promo line
  });

  it('sends the applied code with the registration and stops if the Worker refuses it', async () => {
    mockPromo(SAVE20);
    let previewBody: any = null;
    mockRoute((u, init) => {
      if (!u.includes('/api/register/preview')) return false;
      previewBody = JSON.parse(String(init?.body));
      return true;
    }, 200, {
      payment_reference: 'ref-1',
      final_amount: 700,
      discount_applied: 0,
      discount_blocked: false,
      discount_source: null,
      promo: { error: 'promo_exhausted' },
      payment_required: true,
    });

    const user = userEvent.setup();
    render(<RegisterForm {...buildProps()} />);
    await pickSaturday(user);
    await user.type(screen.getByLabelText(/^phone$/i), '9876543210');
    await user.type(screen.getByLabelText(/^name$/i), 'Asha');
    await user.type(screen.getByLabelText(/^email$/i), 'a@b.c');
    await user.type(screen.getByLabelText(/promo code/i), 'SAVE20');
    await user.click(screen.getByRole('button', { name: /^apply$/i }));
    await screen.findByText(/SAVE20 applied/);

    await user.click(screen.getByRole('button', { name: /continue with 1 ticket/i }));

    await waitFor(() => expect(previewBody?.promo_code).toBe('SAVE20'));
    expect(await screen.findByText('That code has been fully claimed.')).toBeInTheDocument();
    // No payment sheet: the attendee sees the corrected total first.
    expect(screen.queryByText(/pay ₹/i)).not.toBeInTheDocument();
  });
  it('disables sold-out day radios after fetching edition-spots', async () => {
    mockRoute((u) => u.includes('/api/edition-spots/'), 200, {
      day1: { capacity: 250, remaining: 0, sold_out: true },
      day2: { capacity: 250, remaining: 50, sold_out: false },
      both_sold_out: false,
    });
    render(<RegisterForm {...buildProps()} />);
    await waitFor(() => expect(screen.getByLabelText(/saturday/i)).toBeDisabled());
    expect(screen.getByLabelText(/sunday/i)).not.toBeDisabled();
    expect(screen.getByLabelText(/2-day pass/i)).toBeDisabled();
  });

  it('limits ticket quantity to live availability', async () => {
    mockRoute((u) => u.includes('/api/edition-spots/'), 200, {
      day1: { capacity: 250, remaining: 2, sold_out: false },
      day2: { capacity: 250, remaining: 50, sold_out: false },
      both_sold_out: false,
    });
    const user = userEvent.setup();
    render(<RegisterForm {...buildProps()} />);
    await user.click(await screen.findByLabelText(/saturday/i));
    const increase = screen.getByRole('button', { name: /increase ticket quantity/i });
    await user.click(increase);
    expect(increase).toBeDisabled();
    expect(screen.getByText(/tickets \(2 × ₹700\)/i)).toBeInTheDocument();
    expect(screen.getByText(/2 tickets currently available; maximum 2/i)).toBeInTheDocument();
  });

  it('debounces phone lookup and shows guildmaster preview', async () => {
    mockRoute((u) => u.includes('/api/edition-spots/'), 200, {
      day1: { capacity: 250, remaining: 250, sold_out: false },
      day2: { capacity: 250, remaining: 250, sold_out: false },
      both_sold_out: false,
    });
    mockRoute((u) => u.includes('/api/lookup-phone'), 200, {
      user: { found: true, name: 'Asha', email: 'a@b.c' },
      guild: { tier: 'guildmaster', active: true },
      existing_for_edition: { count: 0, has_confirmed: false },
      discount_blocked: false,
    });
    const user = userEvent.setup();
    render(<RegisterForm {...buildProps()} />);
    await user.type(screen.getByLabelText(/phone/i), '9876543210');
    await waitFor(() => expect(screen.getByText(/welcome back, asha/i)).toBeInTheDocument(), { timeout: 2000 });
    expect(screen.getByText(/guildmaster/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/name/i)).toHaveAttribute('readonly');
    expect(screen.getByLabelText(/email/i)).toHaveAttribute('readonly');
    expect(screen.getByText(/existing details are protected/i)).toBeInTheDocument();
  });

  it('renders the anti-split warning when discount_blocked', async () => {
    mockRoute((u) => u.includes('/api/edition-spots/'), 200, {
      day1: { capacity: 250, remaining: 250, sold_out: false },
      day2: { capacity: 250, remaining: 250, sold_out: false },
      both_sold_out: false,
    });
    mockRoute((u) => u.includes('/api/lookup-phone'), 200, {
      user: { found: true, name: 'Asha', email: 'a@b.c' },
      guild: { tier: 'guildmaster', active: true },
      existing_for_edition: { count: 1, has_confirmed: true },
      discount_blocked: true,
    });
    const user = userEvent.setup();
    render(<RegisterForm {...buildProps()} />);
    await user.type(screen.getByLabelText(/phone/i), '9876543210');
    await waitFor(() => expect(screen.getByText(/already registered/i)).toBeInTheDocument(), { timeout: 2000 });
  });

  it("previews multiple tickets and creates no registration until I've paid is clicked", async () => {
    mockRoute((u) => u.includes('/api/edition-spots/'), 200, {
      day1: { capacity: 250, remaining: 250, sold_out: false },
      day2: { capacity: 250, remaining: 250, sold_out: false },
      both_sold_out: false,
    });
    mockRoute((u) => u.includes('/api/lookup-phone'), 200, {
      user: { found: false, name: null, email: null },
      guild: { tier: null, active: false },
      existing_for_edition: { count: 0, has_confirmed: false },
      discount_blocked: false,
    });
    const paymentReference = '11111111-1111-4111-8111-111111111111';
    mockRoute((u) => new URL(u).pathname === '/api/register/preview', 200, {
      payment_reference: paymentReference,
      final_amount: 2100,
      discount_applied: 0,
      discount_blocked: false,
      payment_required: true,
    });
    mockRoute((u) => new URL(u).pathname === '/api/register', 200, {
      registration_id: paymentReference,
      final_amount: 2100,
      discount_applied: 0,
      discount_blocked: false,
      payment_required: true,
    });
    const user = userEvent.setup();
    render(<RegisterForm {...buildProps()} />);
    await user.type(screen.getByLabelText(/phone/i), '9876543210');
    await user.type(screen.getByLabelText(/name/i), 'Smoke');
    await user.type(screen.getByLabelText(/email/i), 'smoke@test.local');
    await user.click(screen.getByLabelText(/saturday/i));
    await user.click(screen.getByRole('button', { name: /increase ticket quantity/i }));
    await user.click(screen.getByRole('button', { name: /increase ticket quantity/i }));
    await user.click(screen.getByRole('button', { name: /continue with 3 tickets/i }));
    await waitFor(() => expect(screen.getByRole('dialog')).toBeInTheDocument());
    const registerCalls = () => (global.fetch as any).mock.calls.filter(([url]: [string]) => new URL(url).pathname === '/api/register');
    expect(registerCalls()).toHaveLength(0);
    await user.click(screen.getByRole('button', { name: /i've paid/i }));
    await waitFor(() => expect(screen.getByText(/got it/i)).toBeInTheDocument());
    expect(registerCalls()).toHaveLength(1);
    expect(JSON.parse(registerCalls()[0][1].body)).toMatchObject({
      registration_id: paymentReference,
      expected_amount: 2100,
      quantity: 3,
    });
    const previewCall = (global.fetch as any).mock.calls.find(([url]: [string]) => new URL(url).pathname === '/api/register/preview');
    expect(JSON.parse(previewCall[1].body)).toMatchObject({ quantity: 3, days: ['day1'] });
  });

  it('closing the payment sheet does not create a registration', async () => {
    mockRoute((u) => u.includes('/api/edition-spots/'), 200, {
      day1: { capacity: 250, remaining: 250, sold_out: false },
      day2: { capacity: 250, remaining: 250, sold_out: false },
      both_sold_out: false,
    });
    mockRoute((u) => new URL(u).pathname === '/api/register/preview', 200, {
      payment_reference: '123e4567-e89b-42d3-a456-426614174000',
      final_amount: 700,
      discount_applied: 0,
      discount_blocked: false,
      payment_required: true,
    });
    mockRoute((u) => new URL(u).pathname === '/api/register', 200, {});
    const user = userEvent.setup();
    render(<RegisterForm {...buildProps()} />);
    await user.type(screen.getByLabelText(/phone/i), '9876543210');
    await user.type(screen.getByLabelText(/name/i), 'Smoke');
    await user.type(screen.getByLabelText(/email/i), 'smoke@test.local');
    await user.click(screen.getByLabelText(/saturday/i));
    await user.click(screen.getByRole('button', { name: /continue with 1 ticket/i }));
    await waitFor(() => expect(screen.getByRole('dialog')).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: /close/i }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    const registerCalls = (global.fetch as any).mock.calls.filter(([url]: [string]) => new URL(url).pathname === '/api/register');
    expect(registerCalls).toHaveLength(0);
  });

  it('shows success screen on amount=0 zero-payment path', async () => {
    mockRoute((u) => u.includes('/api/edition-spots/'), 200, {
      day1: { capacity: 250, remaining: 250, sold_out: false },
      day2: { capacity: 250, remaining: 250, sold_out: false },
      both_sold_out: false,
    });
    mockRoute((u) => u.includes('/api/lookup-phone'), 200, {
      user: { found: false, name: null, email: null },
      guild: { tier: 'guildmaster', active: true },
      existing_for_edition: { count: 0, has_confirmed: false },
      discount_blocked: false,
    });
    mockRoute((u) => new URL(u).pathname === '/api/register/preview', 200, {
      payment_reference: '123e4567-e89b-42d3-a456-426614174000',
      final_amount: 0,
      discount_applied: 700,
      discount_blocked: false,
      payment_required: false,
    });
    mockRoute((u) => new URL(u).pathname === '/api/register', 200, {
      registration_id: '123e4567-e89b-42d3-a456-426614174000',
      final_amount: 0,
      discount_applied: 700,
      discount_blocked: false,
      payment_required: false,
    });
    const user = userEvent.setup();
    render(<RegisterForm {...buildProps()} />);
    await user.type(screen.getByLabelText(/phone/i), '9876543210');
    await user.type(screen.getByLabelText(/name/i), 'GM');
    await user.type(screen.getByLabelText(/email/i), 'gm@test.local');
    await user.click(screen.getByLabelText(/saturday/i));
    await user.click(screen.getByRole('button', { name: /continue with 1 ticket/i }));
    await waitFor(() => expect(screen.getByText(/you're in!/i)).toBeInTheDocument());
  });

  it('shows one shared price before the day choice', async () => {
    mockRoute((u) => u.includes('/api/edition-spots/'), 200, {
      day1: { capacity: 250, remaining: 250, sold_out: false },
      day2: { capacity: 250, remaining: 250, sold_out: false },
      both_sold_out: false,
    });
    render(<RegisterForm {...buildProps()} />);
    expect(screen.getByText(/1-day pass — ₹700/i)).toBeInTheDocument();
    expect(screen.getByText(/^saturday$/i)).toBeInTheDocument();
    expect(screen.getByText(/^sunday$/i)).toBeInTheDocument();
    expect(screen.queryByText(/saturday · ₹/i)).toBeNull();
  });
});
