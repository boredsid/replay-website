import { it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
vi.mock('@/lib/api', () => ({ fetchAdmin: vi.fn(), showApiError: vi.fn() }));
import { fetchAdmin } from '@/lib/api';
import EditionDrawer from './EditionDrawer';

// replay-1 is a real single-day edition: only day1 pricing/capacity, campaign null.
const ONE_DAY = {
  id: 'e1', slug: 'replay-1', name: 'REPLAY', start_date: '2026-01-31', end_date: '2026-01-31',
  daily_start_time: '10:00:00', daily_end_time: '19:00:00',
  venue: 'TBD', capacity_per_day: { day1: 50 },
  pricing: { oneshot: 800, campaign: null, adventurer_cap: 1000 },
  registration_status: 'closed', is_current: false, is_published: true,
};

const TWO_DAY = {
  ...ONE_DAY,
  id: 'e3', slug: 'replay-3', start_date: '2026-09-12', end_date: '2026-09-13',
  capacity_per_day: { day1: 250, day2: 250 },
  pricing: { oneshot: { day1: 700, day2: 700 }, campaign: 1200, adventurer_cap: 1000 },
  registration_status: 'open', is_current: true,
};

beforeEach(() => (fetchAdmin as any).mockReset());

function renderDrawer(edition: any = ONE_DAY) {
  (fetchAdmin as any).mockImplementation((path: string) => {
    if (path === '/api/admin/editions') return Promise.resolve({ editions: [edition] });
    return Promise.resolve({ ok: true });
  });
  return render(
    <MemoryRouter initialEntries={[`/editions/${edition.id}`]}>
      <Routes><Route path="/editions/:id" element={<EditionDrawer />} /></Routes>
    </MemoryRouter>,
  );
}

it('uses one one-day price field and one two-day price field for an active edition', async () => {
  renderDrawer(TWO_DAY);

  expect(await screen.findByLabelText('One-day pass price')).toHaveValue(700);
  expect(screen.getByLabelText('Two-day pass price')).toHaveValue(1200);
  expect(screen.queryByLabelText('Day 1 price')).toBeNull();
  expect(screen.queryByLabelText('Day 2 price')).toBeNull();
});

it('edits a single-day edition without forcing day2 or campaign, and prompts rebuild in-app', async () => {
  renderDrawer();

  // One day → one shared price/capacity input and no two-day price field.
  expect(await screen.findByLabelText('One-day pass price')).toHaveValue(800);
  expect(screen.queryByLabelText('Two-day pass price')).toBeNull();

  await userEvent.click(screen.getByRole('button', { name: /save edition/i }));

  // PATCH body has one scalar day-pass price + campaign null.
  await waitFor(() =>
    expect((fetchAdmin as any)).toHaveBeenCalledWith('/api/admin/editions/e1', expect.objectContaining({
      method: 'PATCH',
      body: expect.stringContaining('"oneshot":800'),
    })),
  );
  const patchCall = (fetchAdmin as any).mock.calls.find((c: any[]) => c[0] === '/api/admin/editions/e1');
  expect(patchCall[1].body).toContain('"campaign":null');

  // In-app rebuild dialog appears (not a native confirm).
  expect(await screen.findByText(/rebuild the site\?/i)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /rebuild now/i })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /do later/i })).toBeInTheDocument();

  // "Do later" must NOT call the rebuild endpoint.
  await userEvent.click(screen.getByRole('button', { name: /do later/i }));
  expect((fetchAdmin as any)).not.toHaveBeenCalledWith('/api/admin/rebuild', expect.anything());
});
