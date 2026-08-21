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
  venue_address: '12 Residency Road, Bengaluru',
  google_maps_url: 'https://maps.app.goo.gl/replay',
  entrance_details: 'Use the north gate.',
  check_in_location: 'Lobby desk',
  nearest_metro_name: 'MG Road', nearest_metro_distance: '700 m',
  nearest_bus_stop_name: 'Mayo Hall', nearest_bus_stop_distance: '250 m',
  parking_availability: 'Limited basement parking', parking_charges: '₹50 per hour',
  food_details: 'Food court on level 2', water_details: 'Refill point at the library desk',
  accessibility_details: 'Step-free entrance and accessible toilets on level 1.',
  game_library_process: 'Borrow one game at a time.', help_on_the_day: 'Ask at the help desk.',
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

it('loads and saves the Plan Your Visit fields', async () => {
  renderDrawer(TWO_DAY);

  expect(await screen.findByLabelText('Venue address')).toHaveValue('12 Residency Road, Bengaluru');
  expect(screen.getByLabelText('Google Maps pin')).toHaveValue('https://maps.app.goo.gl/replay');
  expect(screen.getByLabelText('Nearest Metro station')).toHaveValue('MG Road');
  expect(screen.getByLabelText('Accessibility details')).toHaveValue('Step-free entrance and accessible toilets on level 1.');
  expect(screen.getByLabelText('Game library process')).toHaveValue('Borrow one game at a time.');

  await userEvent.clear(screen.getByLabelText('Parking charges'));
  await userEvent.type(screen.getByLabelText('Parking charges'), '₹60 per hour');
  await userEvent.clear(screen.getByLabelText('Accessibility details'));
  await userEvent.type(screen.getByLabelText('Accessibility details'), 'Step-free entrance, accessible toilet, and quiet seating area.');
  await userEvent.click(screen.getByRole('button', { name: /save edition/i }));

  await waitFor(() => expect((fetchAdmin as any)).toHaveBeenCalledWith('/api/admin/editions/e3', expect.anything()));
  const patchCall = (fetchAdmin as any).mock.calls.find((c: any[]) => c[0] === '/api/admin/editions/e3');
  const payload = JSON.parse(patchCall[1].body);
  expect(payload.google_maps_url).toBe('https://maps.app.goo.gl/replay');
  expect(payload.parking_charges).toBe('₹60 per hour');
  expect(payload.accessibility_details).toBe('Step-free entrance, accessible toilet, and quiet seating area.');
  expect(payload.help_on_the_day).toBe('Ask at the help desk.');
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
