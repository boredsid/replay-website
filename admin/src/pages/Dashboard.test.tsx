import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import Dashboard from './Dashboard';

const fetchAdmin = vi.fn();
vi.mock('@/lib/api', () => ({ fetchAdmin: (...args: unknown[]) => fetchAdmin(...args) }));
const data = {
  edition: { name: 'REPLAY', registration_status: 'open' },
  totals: { confirmed: 220, pending: 8 },
  finances: { net_revenue: 1000, expenses: 1500, profit: -500, average_ticket_income: 250, registrations_to_break_even: 2 },
  spots_by_day: { day1: { capacity: 250, reserved: 120, remaining: 130 }, day2: { capacity: 250, reserved: 108, remaining: 142 } },
  recent_registrations: [{ id: 'r1', users: { name: 'Asha' }, user_phone: '9876543210', pass_type: 'oneshot', payment_status: 'confirmed' }], recent_leads: [],
};
beforeEach(() => { fetchAdmin.mockReset(); fetchAdmin.mockResolvedValue(data); });
describe('dashboard cards', () => {
  it('shows ticket-days and the finance summary instead of cancelled registrations and old revenue', async () => {
    render(<Dashboard />);
    await screen.findByText('Net revenue');
    expect(screen.getByText('220')).toBeInTheDocument();
    expect(screen.getByText('₹1,000')).toBeInTheDocument();
    expect(screen.getByText('130 left')).toBeInTheDocument();
    expect(screen.getByText('Asha')).toBeInTheDocument();
    expect(screen.queryByText('9876543210')).not.toBeInTheDocument();
    expect(screen.getAllByText('Ticket-days · tickets × days')).toHaveLength(2);
    expect(screen.getByText('Expenses')).toBeInTheDocument();
    expect(screen.getByText('Loss to date')).toBeInTheDocument();
    expect(screen.getByText('Registrations to break even')).toBeInTheDocument();
    expect(screen.getByText(/At ₹250 average income per ticket, including memberships and excluding desk entries/)).toBeInTheDocument();
    expect(screen.queryByText('Cancelled', { exact: true })).not.toBeInTheDocument();
    expect(screen.queryByText('Revenue', { exact: true })).not.toBeInTheDocument();
  });
  it('renders operational counts but no finance cards for desk roles', async () => {
    fetchAdmin.mockResolvedValue({ ...data, finances: null }); render(<Dashboard />);
    await screen.findByText('Confirmed');
    expect(screen.queryByText('Net revenue')).not.toBeInTheDocument();
    expect(screen.queryByText('Expenses')).not.toBeInTheDocument();
    expect(screen.queryByText('Registrations to break even')).not.toBeInTheDocument();
  });
  it('shows an unavailable estimate rather than zero if ticket income is missing', async () => {
    fetchAdmin.mockResolvedValue({ ...data, finances: { ...data.finances, average_ticket_income: null, registrations_to_break_even: null } }); render(<Dashboard />);
    await screen.findByText('Registrations to break even');
    expect(screen.getByText('—')).toBeInTheDocument();
    expect(screen.getByText(/Needs confirmed ticket income, from registrations other than desk entries, to estimate/)).toBeInTheDocument();
  });
  it('shows an error instead of false financial totals when loading fails', async () => {
    fetchAdmin.mockRejectedValue(new Error('dashboard_totals_failed')); render(<Dashboard />);
    expect(await screen.findByRole('alert')).toHaveTextContent('dashboard_totals_failed');
    expect(screen.queryByText('Net revenue')).not.toBeInTheDocument();
  });
});
