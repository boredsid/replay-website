import { it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
vi.mock('@/lib/api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api')>('@/lib/api');
  return { fetchAdmin: vi.fn(), showApiError: vi.fn(), ApiError: actual.ApiError };
});
import { fetchAdmin, ApiError } from '@/lib/api';
import RegistrationDrawer from './RegistrationDrawer';

const REG = {
  id: 'r1',
  edition_id: 'e1',
  user_phone: '9876543210',
  pass_type: 'oneshot',
  days: ['day1'],
  seats: 2,
  amount_paid: 1600,
  payment_status: 'pending',
  users: { name: 'Asha', email: 'a@x.com' },
};

/** GET detail + GET editions succeed; every write returns `write`. */
function mockApi(write: (body: any) => any = () => ({ ok: true })) {
  (fetchAdmin as any).mockImplementation(async (path: string, init?: any) => {
    if (path === '/api/admin/editions') return { editions: [] };
    if (!init) return { registration: REG };
    return write(JSON.parse(init.body));
  });
}

function renderDrawer() {
  return render(
    <MemoryRouter initialEntries={['/registrations/r1']}>
      <Routes><Route path="/registrations/:id" element={<RegistrationDrawer />} /></Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => { (fetchAdmin as any).mockReset(); });

it('confirms a pending registration', async () => {
  mockApi();
  renderDrawer();
  await waitFor(() => expect(screen.getByText('Asha')).toBeInTheDocument());
  await userEvent.click(screen.getByRole('button', { name: /confirm/i }));
  await waitFor(() => expect(fetchAdmin as any).toHaveBeenCalledWith(
    '/api/admin/registrations/r1',
    expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ payment_status: 'confirmed' }) }),
  ));
});

it('loads the pass into editable fields', async () => {
  mockApi();
  renderDrawer();
  await waitFor(() => expect(screen.getByLabelText('Tickets')).toHaveValue(2));
  expect(screen.getByLabelText('Pass type')).toHaveValue('oneshot');
  expect(screen.getByLabelText('Amount')).toHaveValue(1600);
  expect(screen.getByRole('button', { name: /save changes/i })).toBeDisabled();
});

it('saves an edited pass type, day, seat count and amount', async () => {
  const bodies: any[] = [];
  mockApi((body) => { bodies.push(body); return { registration: { ...REG, ...body, days: body.days } }; });
  renderDrawer();
  await waitFor(() => expect(screen.getByLabelText('Tickets')).toHaveValue(2));

  await userEvent.selectOptions(screen.getByLabelText('Pass type'), 'campaign');
  await userEvent.clear(screen.getByLabelText('Tickets'));
  await userEvent.type(screen.getByLabelText('Tickets'), '3');
  await userEvent.clear(screen.getByLabelText('Amount'));
  await userEvent.type(screen.getByLabelText('Amount'), '3000');
  await userEvent.click(screen.getByRole('button', { name: /save changes/i }));

  await waitFor(() => expect(bodies).toEqual([
    { pass_type: 'campaign', days: ['day1', 'day2'], seats: 3, amount_paid: 3000 },
  ]));
});

it('sends the chosen single day when the pass stays one-day', async () => {
  const bodies: any[] = [];
  mockApi((body) => { bodies.push(body); return { registration: { ...REG, ...body } }; });
  renderDrawer();
  await waitFor(() => expect(screen.getByLabelText('Tickets')).toHaveValue(2));

  await userEvent.click(screen.getByRole('radio', { name: /sun/i }));
  await userEvent.click(screen.getByRole('button', { name: /save changes/i }));

  await waitFor(() => expect(bodies[0].days).toEqual(['day2']));
});

it('refuses to save a seat count outside 1–20', async () => {
  mockApi();
  renderDrawer();
  await waitFor(() => expect(screen.getByLabelText('Tickets')).toHaveValue(2));

  await userEvent.clear(screen.getByLabelText('Tickets'));
  await userEvent.type(screen.getByLabelText('Tickets'), '25');
  expect(screen.getByRole('button', { name: /save changes/i })).toBeDisabled();
});

it('explains a rejected seat reduction rather than the raw error code', async () => {
  const { toast } = await import('sonner');
  const error = vi.spyOn(toast, 'error').mockImplementation(() => '' as any);
  mockApi(() => { throw new ApiError(409, 'seats_in_use'); });
  renderDrawer();
  await waitFor(() => expect(screen.getByLabelText('Tickets')).toHaveValue(2));

  await userEvent.clear(screen.getByLabelText('Tickets'));
  await userEvent.type(screen.getByLabelText('Tickets'), '1');
  await userEvent.click(screen.getByRole('button', { name: /save changes/i }));

  await waitFor(() => expect(error).toHaveBeenCalledWith(expect.stringMatching(/already checked in/i)));
});

it('names the Guild Path tier that paid for the pass', async () => {
  (fetchAdmin as any).mockImplementation(async (path: string) =>
    path === '/api/admin/editions'
      ? { editions: [] }
      : { registration: { ...REG, amount_paid: 0, discount_applied: 1600, guild_tier_at_purchase: 'guildmaster' } },
  );
  renderDrawer();
  await waitFor(() => expect(screen.getByText('Guild Path — Guildmaster')).toBeInTheDocument());
  expect(screen.getByText(/₹1,600 off at the Guildmaster tier, which covered the pass in full/)).toBeInTheDocument();
});

it('names the promo code when a code beat any guild benefit', async () => {
  (fetchAdmin as any).mockImplementation(async (path: string) =>
    path === '/api/admin/editions'
      ? { editions: [] }
      : { registration: { ...REG, amount_paid: 1200, discount_applied: 400, guild_tier_at_purchase: null, promo_code: 'EARLYBIRD', promo_discount: 400 } },
  );
  renderDrawer();
  await waitFor(() => expect(screen.getByText('Promo code — EARLYBIRD')).toBeInTheDocument());
  expect(screen.getByText(/₹400 off\. No Guild Path benefit applied/)).toBeInTheDocument();
});

it('says a full-price pass carries no discount', async () => {
  mockApi();
  renderDrawer();
  await waitFor(() => expect(screen.getByText('None — full price')).toBeInTheDocument());
});

it('does not pass off an unattributed discount as a guild or promo one', async () => {
  (fetchAdmin as any).mockImplementation(async (path: string) =>
    path === '/api/admin/editions'
      ? { editions: [] }
      : { registration: { ...REG, amount_paid: 600, discount_applied: 1000, guild_tier_at_purchase: null } },
  );
  renderDrawer();
  await waitFor(() => expect(screen.getByText('Not attributed')).toBeInTheDocument());
});

it('flags a free pass that no discount explains, and who entered it', async () => {
  (fetchAdmin as any).mockImplementation(async (path: string) =>
    path === '/api/admin/editions'
      ? { editions: [] }
      : { registration: { ...REG, amount_paid: 0, discount_applied: 0, source: { manual: true, by: 'desk@replaycon.in' } } },
  );
  renderDrawer();
  await waitFor(() => expect(screen.getByText('None recorded')).toBeInTheDocument());
  expect(screen.getByText('By hand at the desk — desk@replaycon.in')).toBeInTheDocument();
});
