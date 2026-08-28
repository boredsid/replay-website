import { beforeEach, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

vi.mock('@/lib/api', () => ({ fetchAdmin: vi.fn(), showApiError: vi.fn() }));
import { fetchAdmin } from '@/lib/api';
import SponsorDrawer from './SponsorDrawer';

const EDITION = {
  id: 'e3', slug: 'replay-3', name: 'REPLAY', start_date: '2026-09-12', end_date: '2026-09-13',
  daily_start_time: '10:00:00', daily_end_time: '19:00:00', venue: 'TBD',
  capacity_per_day: { day1: 250, day2: 250 },
  pricing: { oneshot: 700, campaign: 1200, adventurer_cap: 1000 },
  registration_status: 'upcoming', is_current: true, is_published: true,
};

const SPONSOR = {
  id: 's1',
  edition_id: 'e3',
  name: 'Board Game Company',
  tier: 'association',
  logo_url: 'https://cdn.example/sponsor-logos/e3/a.png',
  logo_path: 'e3/a.png',
  website_url: 'https://boardgamecompany.in/',
  created_at: '2026-08-27T00:00:00.000Z',
  updated_at: '2026-08-27T00:00:00.000Z',
};

beforeEach(() => {
  (fetchAdmin as any).mockReset();
  (fetchAdmin as any).mockImplementation((path: string) => {
    if (path === '/api/admin/editions') return Promise.resolve({ editions: [EDITION] });
    if (path === '/api/admin/sponsors/s1') return Promise.resolve({ sponsor: SPONSOR });
    if (path.startsWith('/api/admin/sponsors/logo')) {
      return Promise.resolve({ logo_url: 'https://cdn.example/sponsor-logos/e3/new.png', logo_path: 'e3/new.png' });
    }
    return Promise.resolve({ ok: true });
  });
  // jsdom has no object-URL support and no image decoder.
  URL.createObjectURL = vi.fn(() => 'blob:preview');
  URL.revokeObjectURL = vi.fn();
});

function renderNew() {
  return render(
    <MemoryRouter initialEntries={['/partner-logos/new?edition_id=e3']}>
      <Routes>
        <Route path="/partner-logos/new" element={<SponsorDrawer />} />
        <Route path="/partner-logos" element={<div>Partner logo list</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

it('uploads the artwork first, then saves the partner pointing at it', async () => {
  const user = userEvent.setup();
  renderNew();

  await screen.findByRole('heading', { name: 'New partner' });
  const file = new File(['png-bytes'], 'Dice Hard.png', { type: 'image/png' });
  await user.upload(screen.getByLabelText('Logo'), file);
  await user.type(screen.getByLabelText('Links to (optional)'), 'https://dicehard.in');
  await user.selectOptions(screen.getByLabelText('Tier'), 'venue');
  await user.click(screen.getByRole('button', { name: 'Add partner' }));

  await waitFor(() => expect(fetchAdmin).toHaveBeenCalledWith(
    '/api/admin/sponsors',
    expect.objectContaining({ method: 'POST' }),
  ));

  const upload = (fetchAdmin as any).mock.calls.find(([path]: [string]) => path.startsWith('/api/admin/sponsors/logo'));
  expect(upload[0]).toBe('/api/admin/sponsors/logo?edition_id=e3');
  expect(upload[1]).toMatchObject({ method: 'POST', headers: { 'Content-Type': 'image/png' } });

  const create = (fetchAdmin as any).mock.calls.find(([path]: [string]) => path === '/api/admin/sponsors');
  expect(JSON.parse(create[1].body)).toMatchObject({
    edition_id: 'e3',
    name: 'Dice Hard',
    tier: 'venue',
    website_url: 'https://dicehard.in',
    logo_url: 'https://cdn.example/sponsor-logos/e3/new.png',
    logo_path: 'e3/new.png',
  });
  expect(await screen.findByText('Partner logo list')).toBeInTheDocument();
});

it('refuses to save a new partner with no artwork', async () => {
  const user = userEvent.setup();
  renderNew();

  await screen.findByRole('heading', { name: 'New partner' });
  await user.type(screen.getByLabelText('Name'), 'Nameless');
  await user.click(screen.getByRole('button', { name: 'Add partner' }));

  await waitFor(() => expect(
    (fetchAdmin as any).mock.calls.filter(([path]: [string]) => path.startsWith('/api/admin/sponsors')),
  ).toHaveLength(0));
});

it('edits an existing partner without re-uploading its artwork', async () => {
  const user = userEvent.setup();
  render(
    <MemoryRouter initialEntries={['/partner-logos/s1']}>
      <Routes>
        <Route path="/partner-logos/:id" element={<SponsorDrawer />} />
        <Route path="/partner-logos" element={<div>Partner logo list</div>} />
      </Routes>
    </MemoryRouter>,
  );

  await screen.findByRole('heading', { name: 'Edit partner' });
  const link = screen.getByLabelText('Links to (optional)');
  await user.clear(link);
  await user.type(link, 'https://boardgamecompany.in/replay');
  await user.click(screen.getByRole('button', { name: 'Save partner' }));

  await waitFor(() => expect(fetchAdmin).toHaveBeenCalledWith(
    '/api/admin/sponsors/s1',
    expect.objectContaining({ method: 'PATCH' }),
  ));
  expect((fetchAdmin as any).mock.calls.some(([path]: [string]) => path.startsWith('/api/admin/sponsors/logo'))).toBe(false);

  const patch = (fetchAdmin as any).mock.calls.find(
    ([path, init]: [string, RequestInit?]) => path === '/api/admin/sponsors/s1' && init?.method === 'PATCH',
  );
  expect(JSON.parse(patch[1].body)).toMatchObject({
    website_url: 'https://boardgamecompany.in/replay',
    logo_url: SPONSOR.logo_url,
    logo_path: 'e3/a.png',
  });
});

it('clears the link when the field is emptied, so the logo stops being clickable', async () => {
  const user = userEvent.setup();
  render(
    <MemoryRouter initialEntries={['/partner-logos/s1']}>
      <Routes>
        <Route path="/partner-logos/:id" element={<SponsorDrawer />} />
        <Route path="/partner-logos" element={<div>Partner logo list</div>} />
      </Routes>
    </MemoryRouter>,
  );

  await screen.findByRole('heading', { name: 'Edit partner' });
  await user.clear(screen.getByLabelText('Links to (optional)'));
  await user.click(screen.getByRole('button', { name: 'Save partner' }));

  await waitFor(() => expect(fetchAdmin).toHaveBeenCalledWith(
    '/api/admin/sponsors/s1',
    expect.objectContaining({ method: 'PATCH' }),
  ));
  const patch = (fetchAdmin as any).mock.calls.find(
    ([path, init]: [string, RequestInit?]) => path === '/api/admin/sponsors/s1' && init?.method === 'PATCH',
  );
  expect(JSON.parse(patch[1].body).website_url).toBeNull();
});
