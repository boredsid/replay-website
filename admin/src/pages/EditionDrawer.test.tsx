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
  venue: 'TBD', capacity_per_day: { day1: 50 },
  pricing: { oneshot: { day1: 800 }, campaign: null, adventurer_cap: 1000 },
  registration_status: 'closed', is_current: false, is_published: true,
};

beforeEach(() => (fetchAdmin as any).mockReset());

function renderDrawer() {
  (fetchAdmin as any).mockImplementation((path: string) => {
    if (path === '/api/admin/editions') return Promise.resolve({ editions: [ONE_DAY] });
    return Promise.resolve({ ok: true });
  });
  return render(
    <MemoryRouter initialEntries={['/editions/e1']}>
      <Routes><Route path="/editions/:id" element={<EditionDrawer />} /></Routes>
    </MemoryRouter>,
  );
}

it('edits a single-day edition without forcing day2 or campaign, and prompts rebuild in-app', async () => {
  renderDrawer();

  // One day → one price/capacity input, no day2, no campaign field.
  expect(await screen.findByLabelText('Day 1 price')).toHaveValue(800);
  expect(screen.queryByLabelText('Day 2 price')).toBeNull();
  expect(screen.queryByLabelText('Campaign')).toBeNull();

  await userEvent.click(screen.getByRole('button', { name: /save edition/i }));

  // PATCH body has day1 only + campaign null — no day2.
  await waitFor(() =>
    expect((fetchAdmin as any)).toHaveBeenCalledWith('/api/admin/editions/e1', expect.objectContaining({
      method: 'PATCH',
      body: expect.stringContaining('"oneshot":{"day1":800}'),
    })),
  );
  const patchCall = (fetchAdmin as any).mock.calls.find((c: any[]) => c[0] === '/api/admin/editions/e1');
  expect(patchCall[1].body).toContain('"campaign":null');
  expect(patchCall[1].body).not.toContain('day2');

  // In-app rebuild dialog appears (not a native confirm).
  expect(await screen.findByText(/rebuild the site\?/i)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /rebuild now/i })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /do later/i })).toBeInTheDocument();

  // "Do later" must NOT call the rebuild endpoint.
  await userEvent.click(screen.getByRole('button', { name: /do later/i }));
  expect((fetchAdmin as any)).not.toHaveBeenCalledWith('/api/admin/rebuild', expect.anything());
});
