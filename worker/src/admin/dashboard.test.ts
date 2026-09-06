import { describe, it, expect, vi } from 'vitest';
vi.mock('../editions', () => ({
  getEditionBySlug: vi.fn(async () => ({ id: 'e1', slug: 'replay-3', name: 'REPLAY', registration_status: 'open' })),
  getCurrentEdition: vi.fn(async () => ({ id: 'e1', slug: 'replay-3', name: 'REPLAY', registration_status: 'open' })),
}));
import { dashboardFinances, handleDashboard } from './dashboard';
import { summarizeFinance, type FinanceSnapshot } from './finance';
import { getEditionBySlug } from '../editions';

const origin = 'https://admin.replaycon.in';
const reg = (overrides = {}) => ({ id: 'r1', created_at: '', payment_status: 'confirmed', amount_paid: 700, discount_applied: 0, guild_tier_at_purchase: null, seats: 1, days: ['day1'], ...overrides });
function snapshot(): FinanceSnapshot {
  return {
    edition: { id: 'e1', slug: 'replay-3', name: 'REPLAY', pricing: { oneshot: 700 }, capacity_per_day: { day1: 250, day2: 250 }, start_date: '2026-09-12', end_date: '2026-09-13' },
    accounts: [{ id: 'a1', name: 'Receiver', staff_email: 'receiver@example.com', automatic_income: true, active: true }],
    registrations: [reg()], partners: [], entries: [],
  };
}
function expense(amount: number) {
  return { id: 'x1', edition_id: 'e1', account_id: 'a1', kind: 'expense' as const, amount, description: 'Venue', category: 'Venue', entry_date: '2026-09-06', notes: '', created_by: 'a', updated_by: 'a', created_at: '', updated_at: '', voided_at: null, void_reason: null };
}
function db(data: FinanceSnapshot, failure = false) {
  return {
    rpc: vi.fn(async () => ({ data: failure ? null : data, error: failure ? {} : null })),
    from: (table: string) => ({ select: () => ({ eq: () => ({ order: () => ({ limit: async () => ({ data: table === 'registrations' ? [{ id: 'r1', users: { name: 'Asha' } }] : [], error: null }) }) }) }) }),
  } as any;
}

describe('dashboard totals', () => {
  it('counts ticket-days, including quantities and two-day passes, and excludes cancellations from capacity', async () => {
    const data = snapshot();
    data.registrations = [reg({ seats: 3, days: ['day1', 'day2'] }), reg({ id: 'r2', seats: 2 }), reg({ id: 'r3', payment_status: 'pending', seats: 4, days: ['day1', 'day2'] }), reg({ id: 'r4', payment_status: 'cancelled', seats: 10 })];
    const sb = db(data);
    const response = await handleDashboard(new Request('https://api.x/api/admin/dashboard'), {} as any, sb, origin, true);
    const body: any = await response.json();
    expect(response.status).toBe(200);
    expect(sb.rpc).toHaveBeenCalledWith('finance_snapshot', { p_edition_id: 'e1' });
    expect(body.totals).toMatchObject({ confirmed: 8, pending: 8 });
    expect(body.spots_by_day.day1).toEqual({ capacity: 250, reserved: 9, remaining: 241 });
    expect(body.spots_by_day.day2.reserved).toBe(7);
    expect(body.recent_registrations[0].users.name).toBe('Asha');
  });
  it('matches finance net revenue, expenses and profit including membership contributions and GST', () => {
    const data = snapshot();
    data.registrations = [reg({ amount_paid: 0, discount_applied: 700, guild_tier_at_purchase: 'guildmaster' }), reg({ id: 'r2', amount_paid: 630, discount_applied: 70 })];
    data.partners = [{ id: 'p1', organization_name: 'Partner', created_at: '', payment_status: 'confirmed', total_amount: 1180, gst_amount: 180 }];
    data.entries = [expense(4330)];
    const finances = dashboardFinances(data);
    const summary = summarizeFinance(data).summary;
    expect(finances).toMatchObject({ net_revenue: summary.net_revenue, expenses: summary.expenses, profit: summary.profit });
    expect(finances).toEqual({ net_revenue: 2330, expenses: 4330, profit: -2000, average_ticket_income: 665, registrations_to_break_even: 4 });
  });
  it('uses tickets, not ticket-days or bookings, for the average selling price', () => {
    const data = snapshot();
    data.registrations = [reg({ seats: 3, days: ['day1', 'day2'], amount_paid: 2400, discount_applied: 1200, guild_tier_at_purchase: 'guildmaster' })];
    data.entries = [expense(6000)];
    expect(dashboardFinances(data)).toMatchObject({ average_ticket_income: 1200, registrations_to_break_even: 2 });
  });
  it('leaves desk entries out of the average, so comps do not inflate the count', () => {
    const data = snapshot();
    data.registrations = [reg({ amount_paid: 700 }), reg({ id: 'desk', amount_paid: 0, source: { manual: true, by: 'desk@replaycon.in' } })];
    data.entries = [expense(2100)];
    // Counting the comp would average ₹350 a ticket and ask for 4 registrations.
    expect(dashboardFinances(data)).toMatchObject({ average_ticket_income: 700, registrations_to_break_even: 2 });
    // Finances reports the same average, not one diluted by the comp.
    expect(summarizeFinance(data).summary).toMatchObject({ average_ticket_income: 700, desk_tickets: 1, desk_ticket_income: 0 });
  });
  it('subtracts what a desk entry did take, and gives no estimate when every ticket is one', () => {
    const data = snapshot();
    data.registrations = [reg({ amount_paid: 700 }), reg({ id: 'desk-cash', amount_paid: 300, seats: 2, source: { manual: true } })];
    data.entries = [expense(2000)];
    expect(dashboardFinances(data)).toMatchObject({ average_ticket_income: 700, registrations_to_break_even: 2 });
    data.registrations = [reg({ id: 'desk-only', amount_paid: 500, source: { manual: true } })];
    expect(dashboardFinances(data)).toMatchObject({ average_ticket_income: null, registrations_to_break_even: null });
  });
  it('does not round the average before calculating break-even', () => {
    const data = snapshot(); data.registrations = [reg({ amount_paid: 1000, seats: 3 })]; data.entries = [expense(2000)];
    expect(dashboardFinances(data).registrations_to_break_even).toBe(3);
  });
  it('returns zero when covered, and no estimate when there is a shortfall without positive ticket income', () => {
    const data = snapshot(); data.registrations = [];
    expect(dashboardFinances(data).registrations_to_break_even).toBe(0);
    data.entries = [expense(100)];
    expect(dashboardFinances(data).registrations_to_break_even).toBeNull();
    data.registrations = [reg({ amount_paid: 0 })];
    expect(dashboardFinances(data).registrations_to_break_even).toBeNull();
  });
  it('supports over 1,000 registrations without truncating ticket-days', async () => {
    const data = snapshot(); data.registrations = Array.from({ length: 1501 }, (_, i) => reg({ id: String(i), seats: 2, days: ['day1', 'day2'] }));
    const body: any = await (await handleDashboard(new Request('https://api.x/api/admin/dashboard'), {} as any, db(data), origin, true)).json();
    expect(body.totals.confirmed).toBe(6004);
  });
  it('does not expose finance data through the volunteer dashboard', async () => {
    const response = await handleDashboard(new Request('https://api.x/api/admin/dashboard'), {} as any, db(snapshot()), origin, false);
    const body: any = await response.json();
    expect(body.finances).toBeNull();
    expect(body.totals.revenue).toBe(0);
    expect(body).not.toHaveProperty('accounts');
    expect(body).not.toHaveProperty('entries');
    expect(body.totals.confirmed).toBe(1);
  });
  it('supports a requested edition and fails closed on a snapshot error', async () => {
    const response = await handleDashboard(new Request('https://api.x/api/admin/dashboard?edition=replay-2'), {} as any, db(snapshot(), true), origin, true);
    expect(getEditionBySlug).toHaveBeenCalledWith({}, 'replay-2');
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: 'dashboard_totals_failed' });
  });
});
