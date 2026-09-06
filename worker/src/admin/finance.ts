import type { SupabaseClient } from '@supabase/supabase-js';
import { adminJson } from './auth';

export interface FinanceAccount { id: string; name: string; staff_email: string; automatic_income: boolean; active: boolean }
export interface FinanceEntry {
  id: string; edition_id: string; account_id: string; kind: 'income' | 'expense'; amount: number;
  gst_credit: number; description: string; category: string; entry_date: string; notes: string;
  created_by: string; updated_by: string; created_at: string; updated_at: string;
  voided_at: string | null; void_reason: string | null;
}
export interface FinanceSnapshot {
  edition: { id: string; slug: string; name: string; pricing: { oneshot?: number }; capacity_per_day: Record<string, number>; start_date: string; end_date: string } | null;
  accounts: FinanceAccount[];
  registrations: { id: string; created_at: string; payment_status: string; amount_paid: number; discount_applied: number; guild_tier_at_purchase: string | null; seats: number; days: string[]; source?: Record<string, unknown> | null }[];
  partners: { id: string; created_at: string; organization_name: string; payment_status: string; total_amount: number; gst_amount: number }[];
  entries: FinanceEntry[];
  // Every category in use, across editions: one coined for REPLAY 3 stays
  // offered in REPLAY 4. Older snapshots predate the key.
  categories?: string[];
}
const paise = (value: number) => Math.round(Number(value) * 100);
const rupees = (value: number) => value / 100;
export function summarizeFinance(snapshot: FinanceSnapshot) {
  const receiver = snapshot.accounts.find((a) => a.automatic_income);
  if (!receiver) throw new Error('Automatic income account is not configured.');
  const totals = { tickets: 0, bgc: 0, partners: 0, gst: 0, manual: 0, expenses: 0, credit: 0, pending: 0, desk: 0 };
  const accounts = snapshot.accounts.map((a) => ({ ...a, income: 0, expenses: 0, bgc: 0 }));
  const recipient = accounts.find((a) => a.id === receiver.id)!;
  const reserved: Record<string, number> = {};
  let confirmedTickets = 0;
  let deskTickets = 0;
  const automatic: { id: string; source_id: string; source: 'registration' | 'partner' | 'bgc'; description: string; amount: number; account_id: string; entry_date: string }[] = [];
  for (const r of snapshot.registrations) {
    if (r.payment_status !== 'cancelled') for (const day of r.days) reserved[day] = (reserved[day] ?? 0) + r.seats;
    if (r.payment_status === 'pending') totals.pending += paise(r.amount_paid);
    if (r.payment_status !== 'confirmed') continue;
    const paid = paise(r.amount_paid);
    // The purchase snapshot identifies the winning discount. A promo winner has
    // no Guild tier, so promo reductions never become BGC income.
    const subsidy = r.guild_tier_at_purchase ? paise(r.discount_applied) : 0;
    totals.tickets += paid; totals.bgc += subsidy; confirmedTickets += r.seats;
    // A row typed in at the desk — a comp, or a booking taken by hand — is not a
    // sale at the going rate, so it is tracked separately for anything that
    // reasons about what the next ticket is worth. It still counts as income.
    if (r.source?.manual === true) { totals.desk += paid + subsidy; deskTickets += r.seats; }
    recipient.income += paid + subsidy; recipient.bgc += subsidy;
    if (paid) automatic.push({ id: `registration:${r.id}`, source_id: r.id, source: 'registration', description: 'Ticket payment', amount: rupees(paid), account_id: receiver.id, entry_date: r.created_at });
    if (subsidy) automatic.push({ id: `bgc:${r.id}`, source_id: r.id, source: 'bgc', description: 'BGC · Guild Path contribution', amount: rupees(subsidy), account_id: receiver.id, entry_date: r.created_at });
  }
  for (const p of snapshot.partners) {
    if (p.payment_status === 'pending') totals.pending += paise(p.total_amount);
    if (p.payment_status !== 'confirmed') continue;
    totals.partners += paise(p.total_amount); totals.gst += paise(p.gst_amount);
    recipient.income += paise(p.total_amount);
    if (Number(p.total_amount)) automatic.push({ id: `partner:${p.id}`, source_id: p.id, source: 'partner', description: p.organization_name, amount: Number(p.total_amount), account_id: receiver.id, entry_date: p.created_at });
  }
  for (const e of snapshot.entries) {
    if (e.voided_at) continue;
    const account = accounts.find((a) => a.id === e.account_id);
    if (!account) throw new Error('Finance entry account is missing.');
    const amount = paise(e.amount);
    if (e.kind === 'income') { totals.manual += amount; account.income += amount; }
    // The GST credit is recorded for later filing only; it never reduces the
    // expense, so profit and account balances stay untouched by it.
    else { totals.expenses += amount; account.expenses += amount; totals.credit += paise(e.gst_credit ?? 0); }
  }
  const income = totals.tickets + totals.bgc + totals.partners + totals.manual;
  const profit = income - totals.gst - totals.expenses;
  return {
    edition: snapshot.edition, entries: snapshot.entries, automatic, categories: snapshot.categories ?? [],
    accounts: accounts.map((a) => ({ ...a, income: rupees(a.income), expenses: rupees(a.expenses), bgc: rupees(a.bgc), balance: rupees(a.income - a.expenses) })),
    summary: {
      ticket_income: rupees(totals.tickets), bgc_income: rupees(totals.bgc), partner_income: rupees(totals.partners), partner_gst: rupees(totals.gst),
      manual_income: rupees(totals.manual), income: rupees(income), expenses: rupees(totals.expenses), expense_gst_credit: rupees(totals.credit),
      net_revenue: rupees(income - totals.gst), profit: rupees(profit), shortfall: rupees(Math.max(0, -profit)), pending_income: rupees(totals.pending),
      confirmed_tickets: confirmedTickets,
      average_ticket_income: confirmedTickets ? rupees(totals.tickets + totals.bgc) / confirmedTickets : null,
      desk_tickets: deskTickets, desk_ticket_income: rupees(totals.desk),
      remaining_day_tickets: Object.entries(snapshot.edition?.capacity_per_day ?? {}).reduce((sum, [day, cap]) => sum + Math.max(0, cap - (reserved[day] ?? 0)), 0),
    },
  };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export async function handleFinance(req: Request, sb: SupabaseClient, origin: string) {
  const editionId = new URL(req.url).searchParams.get('edition_id');
  if (!editionId || !UUID.test(editionId)) return adminJson({ error: 'Select an edition.' }, 400, origin);
  const { data, error } = await sb.rpc('finance_snapshot', { p_edition_id: editionId });
  if (error) return adminJson({ error: 'Could not load finances.' }, 500, origin);
  const snapshot = data as FinanceSnapshot;
  if (!snapshot?.edition) return adminJson({ error: 'Edition not found.' }, 404, origin);
  try { return adminJson(summarizeFinance(snapshot), 200, origin); }
  catch { return adminJson({ error: 'Finance accounts are not configured. Contact a full admin.' }, 503, origin); }
}

export function parseFinanceEntry(body: Record<string, unknown>) {
  const text = (key: string) => typeof body[key] === 'string' ? (body[key] as string).trim() : '';
  const amount = body.amount;
  // Absent means nothing was claimed, which is the same as zero.
  const credit = body.gst_credit === undefined || body.gst_credit === null || body.gst_credit === '' ? 0 : body.gst_credit;
  const date = text('entry_date');
  if (!UUID.test(text('edition_id')) || !UUID.test(text('account_id'))) throw new Error('Select an edition and account.');
  if (body.kind !== 'income' && body.kind !== 'expense') throw new Error('Choose income or expense.');
  if (typeof amount !== 'number' || !Number.isFinite(amount) || amount <= 0 || amount > 999999999.99 || Math.abs(amount * 100 - Math.round(amount * 100)) > 0.00001) throw new Error('Enter a positive amount with at most two decimal places.');
  if (typeof credit !== 'number' || !Number.isFinite(credit) || credit < 0 || Math.abs(credit * 100 - Math.round(credit * 100)) > 0.00001) throw new Error('Enter a GST credit of zero or more with at most two decimal places.');
  if (credit > amount) throw new Error('The GST credit cannot exceed the expense amount.');
  if (credit > 0 && body.kind !== 'expense') throw new Error('Only an expense can carry a GST credit.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date)) || new Date(date).toISOString().slice(0, 10) !== date) throw new Error('Enter a valid date.');
  if (!text('description') || text('description').length > 240 || !text('category') || text('category').length > 80 || text('notes').length > 2000) throw new Error('Enter a description and category within the allowed length.');
  return { edition_id: text('edition_id'), account_id: text('account_id'), kind: body.kind as 'income' | 'expense', amount, gst_credit: credit, entry_date: date, description: text('description'), category: text('category'), notes: text('notes') };
}

export async function handleFinanceSave(req: Request, sb: SupabaseClient, actor: string, origin: string, id?: string) {
  let body: Record<string, unknown>;
  try { body = await req.json(); if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error(); }
  catch { return adminJson({ error: 'Invalid entry.' }, 400, origin); }
  const entryId = id ?? body.id;
  if (typeof entryId !== 'string' || !UUID.test(entryId)) return adminJson({ error: 'Invalid entry ID.' }, 400, origin);
  let before: FinanceEntry | null = null;
  if (id) {
    const result = await sb.from('finance_entries').select('*').eq('id', id).maybeSingle();
    if (result.error) return adminJson({ error: 'Could not load entry.' }, 500, origin);
    before = result.data;
    if (!before) return adminJson({ error: 'Entry not found.' }, 404, origin);
    if (before.voided_at) return adminJson({ error: 'This entry was already voided.' }, 409, origin);
    if (body.updated_at !== before.updated_at) return adminJson({ error: 'This entry changed. Refresh before editing.' }, 409, origin);
  }
  let patch: Record<string, unknown>;
  if (id && body.void_reason !== undefined) {
    const reason = typeof body.void_reason === 'string' ? body.void_reason.trim() : '';
    if (!reason || reason.length > 240) return adminJson({ error: 'Enter a reason for voiding (up to 240 characters).' }, 400, origin);
    patch = { voided_at: new Date().toISOString(), void_reason: reason, updated_by: actor };
  } else {
    let entry: ReturnType<typeof parseFinanceEntry>;
    try { entry = parseFinanceEntry(body); }
    catch (error) { return adminJson({ error: (error as Error).message }, 400, origin); }
    if (before && entry.edition_id !== before.edition_id) return adminJson({ error: 'An entry cannot move between editions.' }, 400, origin);
    const account = await sb.from('finance_accounts').select('staff_email').eq('id', entry.account_id).maybeSingle();
    if (account.error) return adminJson({ error: 'Could not verify account.' }, 500, origin);
    if (!account.data) return adminJson({ error: 'Account not found.' }, 400, origin);
    const staff = await sb.from('staff').select('roles').eq('email', account.data.staff_email).maybeSingle();
    if (staff.error) return adminJson({ error: 'Could not verify account owner.' }, 500, origin);
    // Existing entries may retain a former admin's account when corrected.
    if (!staff.data?.roles?.some((r: string) => r === 'admin' || r === 'basic_admin') && before?.account_id !== entry.account_id) return adminJson({ error: 'Choose an active admin account.' }, 400, origin);
    patch = { ...entry, updated_by: actor };
  }
  const result = id
    ? await sb.from('finance_entries').update(patch).eq('id', id).eq('updated_at', before!.updated_at).is('voided_at', null).select('*').maybeSingle()
    : await sb.from('finance_entries').insert({ ...patch, id: entryId, created_by: actor }).select('*').single();
  if (result.error?.code === '23505' && !id) {
    const previous = await sb.from('finance_entries').select('*').eq('id', entryId).maybeSingle();
    if (!previous.error && previous.data?.created_by === actor && Object.entries(patch).every(([k, v]) => previous.data[k] === v)) return adminJson({ entry: previous.data }, 200, origin);
    return adminJson({ error: 'This entry ID is already in use. Refresh and try again.' }, 409, origin);
  }
  if (result.error) return adminJson({ error: result.error.code === '23503' ? 'Edition or account not found.' : 'Could not save entry.' }, result.error.code === '23503' ? 400 : 500, origin);
  if (!result.data) return adminJson({ error: 'This entry changed. Refresh before editing.' }, 409, origin);
  return adminJson({ entry: result.data }, id ? 200 : 201, origin);
}
