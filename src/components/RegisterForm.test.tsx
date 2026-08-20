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
  pricing: { oneshot: { day1: 700, day2: 700 }, campaign: 1200, adventurer_cap: 1000 },
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
  it('disables sold-out day radios after fetching edition-spots', async () => {
    mockRoute((u) => u.includes('/api/edition-spots/'), 200, {
      day1: { capacity: 250, remaining: 0, sold_out: true },
      day2: { capacity: 250, remaining: 50, sold_out: false },
      both_sold_out: false,
    });
    render(<RegisterForm {...buildProps()} />);
    await waitFor(() => expect(screen.getByLabelText(/saturday/i)).toBeDisabled());
    expect(screen.getByLabelText(/sunday/i)).not.toBeDisabled();
    expect(screen.getByLabelText(/campaign/i)).toBeDisabled();
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

  it('shows UPI sheet on submit when payment_required', async () => {
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
    mockRoute((u) => u.includes('/api/register'), 200, {
      registration_id: 'r1', final_amount: 700, discount_applied: 0, discount_blocked: false, payment_required: true,
    });
    const user = userEvent.setup();
    render(<RegisterForm {...buildProps()} />);
    await user.type(screen.getByLabelText(/phone/i), '9876543210');
    await user.type(screen.getByLabelText(/name/i), 'Smoke');
    await user.type(screen.getByLabelText(/email/i), 'smoke@test.local');
    await user.click(screen.getByLabelText(/saturday/i));
    await user.click(screen.getByRole('button', { name: /register/i }));
    await waitFor(() => expect(screen.getByRole('dialog')).toBeInTheDocument());
    expect(screen.getByText(/i've paid/i)).toBeInTheDocument();
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
    mockRoute((u) => u.includes('/api/register'), 200, {
      registration_id: 'r1', final_amount: 0, discount_applied: 700, discount_blocked: false, payment_required: false,
    });
    const user = userEvent.setup();
    render(<RegisterForm {...buildProps()} />);
    await user.type(screen.getByLabelText(/phone/i), '9876543210');
    await user.type(screen.getByLabelText(/name/i), 'GM');
    await user.type(screen.getByLabelText(/email/i), 'gm@test.local');
    await user.click(screen.getByLabelText(/saturday/i));
    await user.click(screen.getByRole('button', { name: /register/i }));
    await waitFor(() => expect(screen.getByText(/you're in!/i)).toBeInTheDocument());
  });

  it('shows a from-price and the exact price for each day when day prices differ', async () => {
    const edition = {
      ...EDITION,
      pricing: {
        ...EDITION.pricing,
        oneshot: { day1: 700, day2: 900 },
      },
    };
    mockRoute((u) => u.includes('/api/edition-spots/'), 200, {
      day1: { capacity: 250, remaining: 250, sold_out: false },
      day2: { capacity: 250, remaining: 250, sold_out: false },
      both_sold_out: false,
    });
    render(<RegisterForm {...buildProps({ edition })} />);
    expect(screen.getByText(/day pass — from ₹700/i)).toBeInTheDocument();
    expect(screen.getByText(/saturday · ₹700/i)).toBeInTheDocument();
    expect(screen.getByText(/sunday · ₹900/i)).toBeInTheDocument();
  });
});
