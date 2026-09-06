import { describe, expect, it } from 'vitest';
import { handleFinance, handleFinanceSave, parseFinanceEntry, summarizeFinance, type FinanceSnapshot } from './finance';
import { mayReach } from './roles';

const editionId = '11111111-1111-4111-8111-111111111111';
const accountId = '22222222-2222-4222-8222-222222222222';
const entryId = '33333333-3333-4333-8333-333333333333';
const origin = 'https://admin.replaycon.in';
const input = { edition_id: editionId, account_id: accountId, kind: 'expense', amount: 20.25, gst_credit: 0, description: 'Printing', category: 'Printing', entry_date: '2026-09-06', notes: '' };
function snapshot(): FinanceSnapshot {
  return {
    edition: { id: editionId, name: 'REPLAY', slug: 'replay-3', pricing: { oneshot: 700 }, capacity_per_day: { day1: 100, day2: 100 }, start_date: '2026-09-12', end_date: '2026-09-13' },
    accounts: [{ id: accountId, name: 'Receiver', staff_email: 'receiver@example.com', active: true, automatic_income: true }],
    registrations: [], partners: [], entries: [],
  };
}
const reg = (overrides = {}) => ({ id: 'r1', created_at: '2026-09-06T00:00:00Z', payment_status: 'confirmed', amount_paid: 700, discount_applied: 0, guild_tier_at_purchase: null, seats: 1, days: ['day1'], ...overrides });

describe('edition finances', () => {
  it('counts only confirmed payments, uses discounted purchase snapshots and expands capacity by seats/day', () => {
    const data = snapshot();
    data.registrations = [reg(), reg({ id: 'pending', payment_status: 'pending', amount_paid: 1200, seats: 2, days: ['day1', 'day2'] }), reg({ id: 'cancelled', payment_status: 'cancelled' })];
    const result = summarizeFinance(data);
    expect(result.summary).toMatchObject({ ticket_income: 700, pending_income: 1200, confirmed_tickets: 1, remaining_day_tickets: 195 });
    expect(result.automatic).toHaveLength(1);
  });
  it('credits the Guild benefit to BGC, including free and group tickets, but never restores a promo discount', () => {
    const data = snapshot();
    data.registrations = [
      reg({ id: 'guild-free', amount_paid: 0, discount_applied: 700, guild_tier_at_purchase: 'guildmaster' }),
      reg({ id: 'guild-group', amount_paid: 1260, discount_applied: 140, guild_tier_at_purchase: 'initiate', seats: 2 }),
      reg({ id: 'promo', amount_paid: 595, discount_applied: 105 }),
      reg({ id: 'pending-guild', amount_paid: 560, discount_applied: 140, guild_tier_at_purchase: 'initiate', payment_status: 'pending' }),
    ];
    const result = summarizeFinance(data);
    expect(result.summary).toMatchObject({ ticket_income: 1855, bgc_income: 840, income: 2695, confirmed_tickets: 4, average_ticket_income: 673.75 });
    expect(result.accounts[0]).toMatchObject({ income: 2695, bgc: 840, balance: 2695 });
    expect(result.automatic.filter((e) => e.source === 'bgc')).toHaveLength(2);
  });
  it('includes partner GST in the account but reserves it out of profit; ignores voided entries', () => {
    const data = snapshot();
    data.partners = [{ id: 'p1', created_at: '', organization_name: 'Partner', payment_status: 'confirmed', total_amount: 9440, gst_amount: 1440 }];
    data.entries = [
      { ...input, kind: 'expense', amount: 9000, id: entryId, created_by: 'a', updated_by: 'a', created_at: '', updated_at: '', voided_at: null, void_reason: null },
      { ...input, kind: 'income', amount: 50, id: 'other', created_by: 'a', updated_by: 'a', created_at: '', updated_at: '', voided_at: null, void_reason: null },
      { ...input, kind: 'expense', amount: 500, id: 'voided', created_by: 'a', updated_by: 'a', created_at: '', updated_at: '', voided_at: '2026-09-06', void_reason: 'Duplicate' },
    ];
    const result = summarizeFinance(data);
    expect(result.summary).toMatchObject({ income: 9490, net_revenue: 8050, expenses: 9000, profit: -950, shortfall: 950 });
    expect(result.accounts[0].balance).toBe(490);
  });
  it('totals the GST credit recorded on expenses without deducting it anywhere', () => {
    const data = snapshot();
    data.entries = [
      { ...input, kind: 'expense', amount: 1180, gst_credit: 180, id: entryId, created_by: 'a', updated_by: 'a', created_at: '', updated_at: '', voided_at: null, void_reason: null },
      { ...input, kind: 'expense', amount: 590, gst_credit: 90, id: 'voided', created_by: 'a', updated_by: 'a', created_at: '', updated_at: '', voided_at: '2026-09-06', void_reason: 'Duplicate' },
    ];
    const result = summarizeFinance(data);
    expect(result.summary).toMatchObject({ expenses: 1180, expense_gst_credit: 180, profit: -1180 });
    expect(result.accounts[0].balance).toBe(-1180);
  });
  it('does not duplicate automatic revenue across refreshes and reflects corrections and cancellations', () => {
    const data = snapshot(); data.registrations = [reg()];
    expect(summarizeFinance(data)).toEqual(summarizeFinance(data));
    data.registrations[0].amount_paid = 600;
    expect(summarizeFinance(data).summary.income).toBe(600);
    data.registrations[0].payment_status = 'cancelled';
    expect(summarizeFinance(data).summary.income).toBe(0);
  });
  it('keeps paise exact and handles more than 1,000 bookings', () => {
    const data = snapshot(); data.registrations = Array.from({ length: 1501 }, (_, i) => reg({ id: String(i), amount_paid: 0.1 }));
    expect(summarizeFinance(data).summary.income).toBe(150.1);
    expect(summarizeFinance(snapshot()).summary.average_ticket_income).toBeNull();
  });
  it('passes the categories in use through, defaulting to none on an older snapshot', () => {
    expect(summarizeFinance({ ...snapshot(), categories: ['Stall rental', 'Venue'] }).categories).toEqual(['Stall rental', 'Venue']);
    expect(summarizeFinance(snapshot()).categories).toEqual([]);
  });
  it('restricts every finance route to full/basic admins', () => {
    for (const role of ['admin', 'basic_admin', 'check_in', 'library', 'programme']) for (const method of ['GET', 'POST', 'PATCH', 'DELETE']) for (const path of ['/api/admin/finance', '/api/admin/finance/entries', `/api/admin/finance/entries/${entryId}`]) {
      expect(mayReach([role], path, method)).toBe(['admin', 'basic_admin'].includes(role));
    }
  });
  it('fails closed when the snapshot fails, rather than displaying false zero totals', async () => {
    const request = new Request(`https://admin.replaycon.in/api/admin/finance?edition_id=${editionId}`);
    expect((await handleFinance(request, { rpc: async () => ({ error: {} }) } as any, origin)).status).toBe(500);
    expect((await handleFinance(request, { rpc: async () => ({ data: { ...snapshot(), edition: null } }) } as any, origin)).status).toBe(404);
  });
});

describe('manual entries', () => {
  it.each([0, -1, 1.001, Infinity, NaN, '20', 1000000000])('rejects invalid money %s', (amount) => {
    expect(() => parseFinanceEntry({ ...input, amount })).toThrow();
  });
  it.each(['2026-02-30', '2026-13-01', 'not-a-date'])('rejects invalid dates %s', (entry_date) => {
    expect(() => parseFinanceEntry({ ...input, entry_date })).toThrow();
  });
  it.each([-1, 20.26, 1.001, 'x', Infinity])('rejects an invalid GST credit %s', (gst_credit) => {
    expect(() => parseFinanceEntry({ ...input, gst_credit })).toThrow();
  });
  it('keeps income entries free of GST credit and treats a missing credit as zero', () => {
    expect(() => parseFinanceEntry({ ...input, kind: 'income', gst_credit: 1 })).toThrow();
    expect(parseFinanceEntry({ ...input, kind: 'income' })).toMatchObject({ gst_credit: 0 });
    const { gst_credit: _omitted, ...without } = input;
    expect(parseFinanceEntry(without)).toMatchObject({ gst_credit: 0 });
    expect(parseFinanceEntry({ ...input, gst_credit: 20.25 })).toMatchObject({ gst_credit: 20.25 });
  });
  it('strips unknown fields and accepts paise', () => {
    expect(parseFinanceEntry({ ...input, amount: 0.29, created_by: 'forged', voided_at: '2026-09-06' })).toEqual({ ...input, amount: 0.29 });
  });
  function db(options: { existing?: any; roles?: string[]; insertError?: any; updateMissing?: boolean } = {}) {
    const captured: any = {};
    const sb: any = { from(table: string) {
      const builder: any = {
        select: () => builder, eq: () => builder, is: () => builder,
        insert: (row: any) => { captured.row = row; captured.insert = true; return builder; },
        update: (row: any) => { captured.row = row; captured.update = true; return builder; },
        single: async () => ({ data: captured.row, error: options.insertError }),
        maybeSingle: async () => ({ data: table === 'finance_accounts' ? { staff_email: 'owner@example.com' } : table === 'staff' ? { roles: options.roles ?? ['basic_admin'] } : captured.update ? (options.updateMissing ? null : captured.row) : options.existing, error: null }),
      }; return builder;
    } };
    return { sb, captured };
  }
  function request(body: unknown) { return new Request('https://admin.replaycon.in/api/admin/finance/entries', { method: 'POST', body: JSON.stringify(body) }); }
  it('records the authenticated actor, allowing a basic admin account', async () => {
    const { sb, captured } = db();
    const response = await handleFinanceSave(request({ ...input, id: entryId, created_by: 'forged' }), sb, 'actor@example.com', origin);
    expect(response.status).toBe(201);
    expect(captured.row).toMatchObject({ created_by: 'actor@example.com', updated_by: 'actor@example.com', amount: 20.25 });
  });
  it('rejects new entries assigned to a volunteer account', async () => {
    const { sb, captured } = db({ roles: ['library'] });
    expect((await handleFinanceSave(request({ ...input, id: entryId }), sb, 'actor', origin)).status).toBe(400);
    expect(captured.insert).toBeUndefined();
  });
  it('makes an identical retried create idempotent', async () => {
    const existing = { ...input, id: entryId, created_by: 'actor', updated_by: 'actor' };
    const { sb } = db({ existing, insertError: { code: '23505' } });
    expect((await handleFinanceSave(request(existing), sb, 'actor', origin)).status).toBe(200);
  });
  it('rejects a stale edit and a concurrent edit without overwriting', async () => {
    const existing = { ...input, updated_at: 'new', voided_at: null };
    const first = db({ existing });
    expect((await handleFinanceSave(request({ ...input, updated_at: 'old' }), first.sb, 'actor', origin, entryId)).status).toBe(409);
    expect(first.captured.update).toBeUndefined();
    const second = db({ existing, updateMissing: true });
    expect((await handleFinanceSave(request({ ...input, updated_at: 'new' }), second.sb, 'actor', origin, entryId)).status).toBe(409);
  });
  it('voids with an actor and reason instead of deleting', async () => {
    const { sb, captured } = db({ existing: { ...input, updated_at: 'now', voided_at: null } });
    expect((await handleFinanceSave(request({ updated_at: 'now', void_reason: ' Duplicate ' }), sb, 'actor', origin, entryId)).status).toBe(200);
    expect(captured.row).toMatchObject({ void_reason: 'Duplicate', updated_by: 'actor' });
    expect(captured.row.voided_at).toBeTruthy();
  });
});
