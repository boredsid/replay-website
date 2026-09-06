import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import { fetchAdmin } from '@/lib/api';
import { onRevalidate } from '@/lib/revalidate';
import { useCanWrite, useWhoAmI } from '@/lib/whoami';
import { breakEven, type FinanceEntry, type FinanceReport } from '@/lib/finance';
import type { EditionRow } from '@/lib/types';

const money = (v: number) => `₹${Number(v).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
const field = 'w-full rounded-md border bg-background px-3 py-2 text-sm';
const button = 'rounded-md border px-3 py-2 text-sm font-medium disabled:opacity-50';
// Seeds only: a category exists because an entry uses it, so the dropdown grows
// as entries are added and these are simply always offered.
const seedCategories = ['Venue', 'Food & drinks', 'Printing', 'Marketing', 'Transport', 'Equipment', 'General', 'Other income'];
const addCategory = '__add__';
const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const displayDate = (value: string) => value.length === 10 ? value : new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium' }).format(new Date(value));

export default function Finance() {
  const allowed = useCanWrite();
  return allowed ? <FinancePage /> : <div className="p-6">Finances are available to full and basic admins.</div>;
}

function FinancePage() {
  const who = useWhoAmI();
  const [editions, setEditions] = useState<EditionRow[]>([]);
  const [editionId, setEditionId] = useState('');
  const [report, setReport] = useState<FinanceReport | null>(null);
  const [error, setError] = useState('');
  const [refresh, setRefresh] = useState(0);
  const [editor, setEditor] = useState<FinanceEntry | 'new' | null>(null);
  const [ticketIncome, setTicketIncome] = useState('');
  const [variableCost, setVariableCost] = useState('0');
  const [filter, setFilter] = useState('all');
  const [accountFilter, setAccountFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [limit, setLimit] = useState(50);
  useEffect(() => {
    let active = true;
    fetchAdmin<{ editions: EditionRow[] }>('/api/admin/editions').then(({ editions: rows }) => {
      if (!active) return;
      setEditions(rows); setEditionId((previous) => rows.some((e) => e.id === previous) ? previous : (rows.find((e) => e.is_current) ?? rows[0])?.id ?? '');
      if (!rows.length) setError('Create an edition to start tracking finances.');
    }).catch((e) => { if (active) setError(e.message); });
    return () => { active = false; };
  }, [refresh]);
  useEffect(() => { const off = onRevalidate(() => setRefresh((v) => v + 1)); return () => { off(); }; }, []);
  useEffect(() => {
    if (!editionId) return;
    let active = true;
    setReport(null); setError('');
    fetchAdmin<FinanceReport>(`/api/admin/finance?edition_id=${encodeURIComponent(editionId)}`)
      .then((data) => { if (active) setReport(data); })
      .catch((e) => { if (active) setError(e.message); });
    return () => { active = false; };
  }, [editionId, refresh]);

  const s = report?.summary;
  const listPrice = report?.edition.pricing.oneshot;
  const defaultPrice = typeof listPrice === 'number' && Number.isFinite(listPrice) ? listPrice : s?.average_ticket_income ?? 0;
  const price = ticketIncome === '' ? defaultPrice : Number(ticketIncome);
  const needed = s ? breakEven(s.shortfall, price, Number(variableCost)) : null;
  const accountName = (id: string) => report?.accounts.find((a) => a.id === id)?.name ?? 'Unknown account';
  const rows = report ? [
    ...report.automatic.map((e) => ({ ...e, kind: 'income', category: e.source === 'bgc' ? 'BGC contribution' : e.source === 'partner' ? 'Partners' : 'Tickets', manual: null as FinanceEntry | null, voided: false })),
    ...report.entries.map((e) => ({ ...e, source: 'manual', source_id: e.id, manual: e, voided: Boolean(e.voided_at) })),
  ].filter((e) => (filter === 'voided' ? e.voided : !e.voided && (filter === 'all' || filter === 'automatic' && e.source !== 'manual' || e.kind === filter || e.source === filter))
    && (accountFilter === 'all' || e.account_id === accountFilter)
    && `${e.description} ${e.category} ${e.source_id}`.toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) => b.entry_date.localeCompare(a.entry_date)) : [];

  return <div className="space-y-5 p-4 md:p-6">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><h1 className="text-2xl font-bold">Finances</h1><p className="text-sm text-muted-foreground">Income, expenses and the path to break-even for each REPLAY edition.</p></div>
      <button className={`${button} bg-primary text-primary-foreground`} disabled={!report || editor !== null} onClick={() => setEditor('new')}>Add income / expense</button>
    </div>
    <div className="flex gap-2"><select aria-label="Edition" className={`${field} max-w-sm`} value={editionId} disabled={editor !== null} onChange={(e) => { setEditionId(e.target.value); setReport(null); setTicketIncome(''); setVariableCost('0'); setLimit(50); }}>
      {editions.map((e) => <option key={e.id} value={e.id}>{e.slug} — {e.name}</option>)}
    </select><button className={button} disabled={editor !== null} onClick={() => setRefresh((v) => v + 1)}>Refresh</button></div>
    {error && <div role="alert" className="rounded-lg border border-destructive p-4 text-destructive">{error}</div>}
    {!report && !error && <p role="status">Loading finances…</p>}
    {report && s && <>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {[
          ['Net revenue', money(s.net_revenue), 'Includes membership constributions; excludes partner GST'],
          ['Expenses', money(s.expenses), s.expense_gst_credit ? `All recorded expenses; ${money(s.expense_gst_credit)} GST credit noted on them and not deducted` : 'All recorded expenses for this edition'],
          [s.profit < 0 ? 'Loss to date' : s.profit > 0 ? 'Profit to date' : 'Break-even', money(Math.abs(s.profit)), 'Based on recorded income and expenses'],
          ['Registrations to break even', needed === null ? 'Not reachable' : String(needed), `At ${money(price)} income and ${money(Number(variableCost) || 0)} extra cost per ticket`],
        ].map(([label, value, hint]) => <div key={label} className="rounded-xl border bg-background p-4"><p className="text-sm text-muted-foreground">{label}</p><p className={`my-2 text-2xl font-bold ${label === 'Loss to date' ? 'text-destructive' : ''}`}>{value}</p><p className="text-xs text-muted-foreground">{hint}</p></div>)}
      </div>
      <div className="grid gap-4 xl:grid-cols-2">
        <section className="rounded-xl border bg-background p-4"><h2 className="mb-3 font-semibold">Income breakdown</h2><dl className="space-y-2 text-sm">
          {[
            ['Confirmed ticket payments', s.ticket_income], ['BGC · Guild Path contributions', s.bgc_income],
            ['Confirmed partner payments (including GST)', s.partner_income], ['Other income', s.manual_income],
            ['Partner GST reserved', -s.partner_gst],
          ].map(([label, amount]) => <div key={label} className="flex justify-between gap-3"><dt>{label}</dt><dd className="whitespace-nowrap font-medium">{money(Number(amount))}</dd></div>)}
        </dl><p className="mt-4 text-xs text-muted-foreground">{money(s.pending_income)} pending payments excluded. BGC covers the Guild Path discount on confirmed tickets; promo discounts remain discounts. BGC contributions count as income before settlement, so totals are not bank balances. Do not add those payments again as manual income.</p></section>
        <section className="rounded-xl border bg-background p-4"><h2 className="mb-3 font-semibold">Break-even estimate</h2><div className="grid gap-3 sm:grid-cols-2">
          <label className="space-y-1 text-sm">Expected income per ticket (₹)<input className={field} type="number" min="0" step="0.01" value={ticketIncome === '' ? price : ticketIncome} onChange={(e) => setTicketIncome(e.target.value)} /></label>
          <label className="space-y-1 text-sm">Extra cost per ticket (₹)<input className={field} type="number" min="0" step="0.01" value={variableCost} onChange={(e) => setVariableCost(e.target.value)} /></label>
        </div><p className="mt-3 text-sm">{s.shortfall ? `${money(s.shortfall)} left to cover.` : 'Recorded costs are covered.'} {needed === null && 'Ticket income must exceed the extra cost per ticket.'}</p>
        <p className="mt-2 text-xs text-muted-foreground">Assumes one ticket per new registration, no further fixed expenses, and the income entered above. Defaults to the current one-day price. Group bookings, discounts and two-day passes change this estimate. {s.average_ticket_income !== null && `Income so far averages ${money(s.average_ticket_income)} per ticket, including BGC and excluding desk entries.`}</p>
        <p className={`mt-2 text-xs ${needed !== null && needed > s.remaining_day_tickets ? 'text-destructive' : 'text-muted-foreground'}`}>{s.remaining_day_tickets} one-day ticket places remain after confirmed and pending bookings.{needed !== null && needed > s.remaining_day_tickets ? ' The estimate exceeds that capacity; more partner income or lower costs are needed.' : ''}</p></section>
      </div>
      <section><h2 className="mb-2 font-semibold">Accounts</h2><div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{report.accounts.filter((a) => a.active || a.income || a.expenses).map((a) => <div key={a.id} className="rounded-xl border bg-background p-4">
        <div className="flex justify-between gap-2"><h3 className="font-medium">{a.name}</h3>{!a.active && <span className="text-xs text-muted-foreground">Former admin</span>}</div>
        {a.automatic_income && <p className="text-xs text-muted-foreground">Ticket, BGC and partner income credited here</p>}
        <dl className="mt-3 grid grid-cols-3 gap-2 text-sm"><div><dt className="text-xs text-muted-foreground">Income</dt><dd>{money(a.income)}</dd></div><div><dt className="text-xs text-muted-foreground">Expenses</dt><dd>{money(a.expenses)}</dd></div><div><dt className="text-xs text-muted-foreground">Net recorded</dt><dd className="font-semibold">{money(a.balance)}</dd></div></dl>
      </div>)}</div><p className="mt-2 text-xs text-muted-foreground">Accounts show who received income or paid expenses. Net recorded includes BGC contributions and partner GST; it is not a settlement balance.</p></section>
      {editor !== null && <EntryEditor key={editor === 'new' ? `new-${editionId}` : editor.id} entry={editor === 'new' ? null : editor} report={report} actor={who?.email ?? ''} onClose={() => setEditor(null)} />}
      <section className="space-y-3"><h2 className="font-semibold">Transactions</h2><div className="grid gap-2 sm:grid-cols-3">
        <input aria-label="Search transactions" placeholder="Search description, category or reference" className={field} value={search} onChange={(e) => { setSearch(e.target.value); setLimit(50); }} />
        <select aria-label="Transaction type" className={field} value={filter} onChange={(e) => { setFilter(e.target.value); setLimit(50); }}>{[['all', 'All active entries'], ['income', 'Income'], ['expense', 'Expenses'], ['automatic', 'Automatic income'], ['manual', 'Manual entries'], ['voided', 'Voided entries']].map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
        <select aria-label="Account filter" className={field} value={accountFilter} onChange={(e) => { setAccountFilter(e.target.value); setLimit(50); }}><option value="all">All accounts</option>{report.accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select>
      </div><div className="overflow-x-auto rounded-lg border bg-background"><table className="w-full text-left text-sm"><thead className="bg-muted"><tr>{['Date', 'Description', 'Account', 'Amount', 'Source / action'].map((h) => <th key={h} className="p-3">{h}</th>)}</tr></thead><tbody>
        {rows.slice(0, limit).map((e) => <tr key={e.id} className="border-t"><td className="whitespace-nowrap p-3">{displayDate(e.entry_date)}</td><td className="min-w-44 p-3"><div>{e.description}</div><div className="text-xs text-muted-foreground">{e.category}{Number(e.manual?.gst_credit) > 0 ? ` · ${money(Number(e.manual?.gst_credit))} GST credit` : ''}{e.voided ? ` · Voided: ${e.manual?.void_reason}` : ''}</div></td><td className="p-3">{accountName(e.account_id)}</td><td className="whitespace-nowrap p-3 font-medium">{e.kind === 'expense' ? '−' : '+'}{money(e.amount)}</td><td className="p-3">{e.manual ? <button className={button} disabled={editor !== null || e.voided} onClick={() => setEditor(e.manual)}>Edit / void</button> : <Link className="underline" to={`/${e.source === 'partner' ? 'partners' : 'registrations'}/${e.source_id}`}>{e.source === 'bgc' ? 'BGC · booking' : e.source === 'partner' ? 'Partner' : 'Booking'}</Link>}</td></tr>)}
        {!rows.length && <tr><td colSpan={5} className="p-6 text-center text-muted-foreground">No transactions match these filters.</td></tr>}
      </tbody></table></div>{rows.length > limit && <button className={button} onClick={() => setLimit((v) => v + 50)}>Show 50 more ({rows.length} total)</button>}</section>
    </>}
  </div>;
}

function EntryEditor({ entry, report, actor, onClose }: { entry: FinanceEntry | null; report: FinanceReport; actor: string; onClose: () => void }) {
  const editorRef = useRef<HTMLElement>(null);
  useEffect(() => { editorRef.current?.focus(); }, []);
  const id = useRef(entry?.id ?? crypto.randomUUID());
  const [kind, setKind] = useState(entry?.kind ?? 'expense');
  const [account, setAccount] = useState(entry?.account_id ?? report.accounts.find((a) => a.staff_email === actor)?.id ?? '');
  const [amount, setAmount] = useState(entry ? String(entry.amount) : '');
  const [gstCredit, setGstCredit] = useState(entry && Number(entry.gst_credit) ? String(entry.gst_credit) : '');
  const [description, setDescription] = useState(entry?.description ?? '');
  const [category, setCategory] = useState(entry?.category ?? 'General');
  const [adding, setAdding] = useState(false);
  // Categories in use anywhere, so one coined for a past edition stays offered.
  const categories = useMemo(() => [...new Set([...seedCategories, ...(report.categories ?? []), ...(entry ? [entry.category] : [])])].sort((a, b) => a.localeCompare(b)), [report.categories, entry]);
  const [date, setDate] = useState(entry?.entry_date ?? today());
  const [notes, setNotes] = useState(entry?.notes ?? '');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function save(event: FormEvent, voidEntry = false) {
    event.preventDefault(); if (busy) return; setBusy(true); setError('');
    // A new name that only differs in case is the same category; keep the
    // spelling already in use so the dropdown doesn't collect near-duplicates.
    const named = category.trim();
    const chosen = categories.find((c) => c.toLowerCase() === named.toLowerCase()) ?? named;
    try {
      await fetchAdmin(`/api/admin/finance/entries${entry ? `/${entry.id}` : ''}`, {
        method: entry ? 'PATCH' : 'POST', body: JSON.stringify(voidEntry ? { updated_at: entry?.updated_at, void_reason: reason } : {
          id: id.current, edition_id: report.edition.id, account_id: account, kind, amount: Number(amount),
          gst_credit: kind === 'expense' && gstCredit !== '' ? Number(gstCredit) : 0,
          description, category: chosen, entry_date: date, notes, updated_at: entry?.updated_at,
        }),
      });
      toast.success(voidEntry ? 'Entry voided' : 'Entry saved'); onClose();
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not save entry.'); }
    finally { setBusy(false); }
  }
  return <section ref={editorRef} tabIndex={-1} className="rounded-xl border-2 border-primary bg-background p-4" aria-label={entry ? 'Edit entry' : 'New entry'}>
    <h2 className="mb-3 font-semibold">{entry ? 'Edit entry' : 'New income or expense'}</h2>
    <form onSubmit={(e) => save(e)}><fieldset disabled={busy} className="space-y-3"><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      <label className="space-y-1 text-sm">Type<select className={field} value={kind} onChange={(e) => { setKind(e.target.value as 'income' | 'expense'); if (e.target.value === 'income') setGstCredit(''); }}><option value="expense">Expense</option><option value="income">Income</option></select></label>
      <label className="space-y-1 text-sm">{kind === 'expense' ? 'Paid by' : 'Received by'}<select required className={field} value={account} onChange={(e) => setAccount(e.target.value)}><option value="">Choose an admin</option>{report.accounts.filter((a) => a.active || a.id === entry?.account_id).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></label>
      <label className="space-y-1 text-sm">Amount (₹)<input required className={field} type="number" min="0.01" max="999999999.99" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} /></label>
      {kind === 'expense' && <label className="space-y-1 text-sm">GST credit (₹)<input className={field} type="number" min="0" max={amount || '999999999.99'} step="0.01" placeholder="0.00" value={gstCredit} onChange={(e) => setGstCredit(e.target.value)} /></label>}
      <label className="space-y-1 text-sm">Description<input required maxLength={240} className={field} value={description} onChange={(e) => setDescription(e.target.value)} /></label>
      <div className="space-y-1 text-sm"><label className="block space-y-1">{adding ? 'New category' : 'Category'}
        {adding
          ? <input required autoFocus maxLength={80} className={field} placeholder="Name it as you'd file it" value={category} onChange={(e) => setCategory(e.target.value)} />
          : <select required className={field} value={category} onChange={(e) => { if (e.target.value === addCategory) { setAdding(true); setCategory(''); } else setCategory(e.target.value); }}>
            <option value="">Choose a category</option>
            {categories.map((c) => <option key={c} value={c}>{c}</option>)}
            <option value={addCategory}>+ Add a new category…</option>
          </select>}
      </label>{adding && <button type="button" className="text-xs underline" onClick={() => { setAdding(false); setCategory(entry?.category ?? 'General'); }}>Use an existing category</button>}</div>
      <label className="space-y-1 text-sm">Date<input required type="date" className={field} value={date} onChange={(e) => setDate(e.target.value)} /></label>
    </div><label className="block space-y-1 text-sm">Notes / receipt reference<textarea className={field} maxLength={2000} value={notes} onChange={(e) => setNotes(e.target.value)} /></label>
    <p className="text-xs text-muted-foreground">Record the full expense amount, and the GST on it separately if the invoice shows input credit. The credit is kept for filing only: it is not deducted from expenses, profit or account balances. Ticket, partner and BGC income appears automatically; don't enter it again.</p>
    <div className="flex gap-2"><button className={`${button} bg-primary text-primary-foreground`} type="submit">{busy ? 'Saving…' : 'Save entry'}</button><button type="button" className={button} onClick={onClose}>Cancel</button></div></fieldset></form>
    {entry && <form className="mt-4 flex flex-wrap items-end gap-2 border-t pt-4" onSubmit={(e) => save(e, true)}><label className="min-w-60 flex-1 space-y-1 text-sm">Reason for voiding<input required maxLength={240} disabled={busy} className={field} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Duplicate, entered in error…" /></label><button disabled={busy} className={`${button} text-destructive`}>Void entry</button><p className="w-full text-xs text-muted-foreground">Voiding removes this entry from totals and keeps its audit history. Added by {entry.created_by}.</p></form>}
    {error && <p role="alert" className="mt-3 text-sm text-destructive">{error}</p>}
  </section>;
}
