import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FinanceReport } from '@/lib/finance';

const fetchAdmin = vi.fn();
let allowed = true;
vi.mock('@/lib/api', () => ({ fetchAdmin: (...args: unknown[]) => fetchAdmin(...args) }));
vi.mock('@/lib/whoami', () => ({ useCanWrite: () => allowed, useWhoAmI: () => ({ email: 'me@example.com' }) }));
vi.mock('sonner', () => ({ toast: { success: vi.fn() } }));
import Finance from './Finance';
const editionId = '11111111-1111-4111-8111-111111111111';
const secondId = '22222222-2222-4222-8222-222222222222';
const accountId = '33333333-3333-4333-8333-333333333333';
const report: FinanceReport = {
  edition: { id: editionId, name: 'REPLAY', slug: 'replay-3', pricing: { oneshot: 700 } },
  accounts: [{ id: accountId, name: 'Me', staff_email: 'me@example.com', active: true, automatic_income: true, income: 700, expenses: 2100, balance: -1400, bgc: 140 }],
  entries: [], automatic: [],
  summary: { ticket_income: 560, bgc_income: 140, partner_income: 0, partner_gst: 0, manual_income: 0, income: 700, net_revenue: 700, expenses: 2100, expense_gst_credit: 0, profit: -1400, shortfall: 1400, pending_income: 0, confirmed_tickets: 1, average_ticket_income: 700, desk_tickets: 0, desk_ticket_income: 0, remaining_day_tickets: 100 },
};
beforeEach(() => {
  allowed = true; fetchAdmin.mockReset();
  fetchAdmin.mockImplementation(async (path: string, init?: RequestInit) => {
    if (path === '/api/admin/editions') return { editions: [{ id: editionId, slug: 'replay-3', name: 'REPLAY', is_current: true }, { id: secondId, slug: 'replay-2', name: 'Previous' }] };
    if (init) return { entry: {} };
    return { ...report, edition: { ...report.edition, id: path.includes(secondId) ? secondId : editionId } };
  });
});
const show = () => render(<MemoryRouter><Finance /></MemoryRouter>);

describe('finance page', () => {
  it('blocks desk roles before fetching any financial data', () => {
    allowed = false; show();
    expect(screen.getByText(/available to full and basic admins/)).toBeInTheDocument();
    expect(fetchAdmin).not.toHaveBeenCalled();
  });
  it('shows loss and BGC income and updates break-even with added cost', async () => {
    show(); await screen.findByText('Loss to date');
    expect(screen.getByText('BGC · Guild Path contributions')).toBeInTheDocument();
    const card = screen.getByText('Registrations to break even').parentElement!;
    expect(card).toHaveTextContent('2');
    const cost = screen.getByLabelText('Extra cost per ticket (₹)');
    await userEvent.clear(cost); await userEvent.type(cost, '600');
    expect(card).toHaveTextContent('14');
  });
  it('saves a manual expense under the selected edition and active admin account', async () => {
    show(); await screen.findByText('Loss to date');
    await userEvent.selectOptions(screen.getByLabelText('Edition'), secondId);
    await screen.findByText('Loss to date');
    await userEvent.click(screen.getByRole('button', { name: 'Add income / expense' }));
    await userEvent.type(screen.getByLabelText('Amount (₹)'), '500.25');
    await userEvent.type(screen.getByLabelText('Description'), 'Print wristbands');
    await userEvent.click(screen.getByRole('button', { name: 'Save entry' }));
    await waitFor(() => expect(fetchAdmin.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(true));
    const [, init] = fetchAdmin.mock.calls.find(([, init]) => init?.method === 'POST')!;
    expect(JSON.parse(init.body)).toMatchObject({ edition_id: secondId, account_id: accountId, kind: 'expense', amount: 500.25, description: 'Print wristbands' });
  });
  it('records a GST credit on an expense and drops it when the entry becomes income', async () => {
    show(); await screen.findByText('Loss to date');
    await userEvent.click(screen.getByRole('button', { name: 'Add income / expense' }));
    await userEvent.type(screen.getByLabelText('Amount (₹)'), '1180');
    await userEvent.type(screen.getByLabelText('GST credit (₹)'), '180');
    await userEvent.type(screen.getByLabelText('Description'), 'Venue advance');
    await userEvent.click(screen.getByRole('button', { name: 'Save entry' }));
    await waitFor(() => expect(fetchAdmin.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(true));
    expect(JSON.parse(fetchAdmin.mock.calls.find(([, init]) => init?.method === 'POST')![1].body)).toMatchObject({ amount: 1180, gst_credit: 180 });
    await userEvent.click(await screen.findByRole('button', { name: 'Add income / expense' }));
    await userEvent.type(screen.getByLabelText('Amount (₹)'), '500');
    await userEvent.type(screen.getByLabelText('GST credit (₹)'), '90');
    await userEvent.type(screen.getByLabelText('Description'), 'Sponsor top-up');
    await userEvent.selectOptions(screen.getByLabelText('Type'), 'income');
    expect(screen.queryByLabelText('GST credit (₹)')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Save entry' }));
    await waitFor(() => expect(fetchAdmin.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(2));
    expect(JSON.parse(fetchAdmin.mock.calls.filter(([, init]) => init?.method === 'POST')[1][1].body)).toMatchObject({ kind: 'income', gst_credit: 0 });
  });
  it('preserves the selected historical edition on refresh', async () => {
    show(); await screen.findByText('Loss to date');
    await userEvent.selectOptions(screen.getByLabelText('Edition'), secondId);
    await screen.findByText('Loss to date');
    await userEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    await screen.findByText('Loss to date');
    expect(screen.getByLabelText('Edition')).toHaveValue(secondId);
  });
  it('uses the observed average for historical editions with legacy pricing', async () => {
    const original = fetchAdmin.getMockImplementation()!;
    fetchAdmin.mockImplementation(async (path, init) => {
      const data = await original(path, init);
      if (data.summary) return { ...data, edition: { ...data.edition, pricing: { oneshot: { day1: 500, day2: 600 } } }, summary: { ...data.summary, average_ticket_income: 550 } };
      return data;
    });
    show(); await screen.findByText('Loss to date');
    expect(screen.getByLabelText('Expected income per ticket (₹)')).toHaveValue(550);
  });
  it('shows load errors without displaying zero profit', async () => {
    fetchAdmin.mockImplementation(async (path: string) => {
      if (path === '/api/admin/editions') return { editions: [{ id: editionId, slug: 'replay-3', name: 'REPLAY' }] };
      throw new Error('Could not load finances.');
    });
    show(); expect(await screen.findByRole('alert')).toHaveTextContent('Could not load finances.');
    expect(screen.queryByText('Profit to date')).not.toBeInTheDocument();
  });
  it('retains the same entry ID after a failed save so retry cannot duplicate it', async () => {
    const original = fetchAdmin.getMockImplementation()!;
    fetchAdmin.mockImplementation(async (path, init) => {
      if (init?.method === 'POST') throw new Error('Connection interrupted');
      return original(path, init);
    });
    show(); await screen.findByText('Loss to date');
    await userEvent.click(screen.getByRole('button', { name: 'Add income / expense' }));
    await userEvent.type(screen.getByLabelText('Amount (₹)'), '50');
    await userEvent.type(screen.getByLabelText('Description'), 'Printing');
    await userEvent.click(screen.getByRole('button', { name: 'Save entry' }));
    await screen.findByRole('alert');
    await userEvent.click(screen.getByRole('button', { name: 'Save entry' }));
    await waitFor(() => expect(fetchAdmin.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(2));
    const writes = fetchAdmin.mock.calls.filter(([, init]) => init?.method === 'POST');
    expect(JSON.parse(writes[0][1].body).id).toBe(JSON.parse(writes[1][1].body).id);
  });
});
