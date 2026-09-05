import { useEffect, useState, useCallback, useRef } from 'react';
import { useCanWrite } from '@/lib/whoami';
import { Link, useNavigate } from 'react-router-dom';
import { fetchAdmin, showApiError } from '@/lib/api';
import type { RegistrationRow, PaymentStatus, EditionRow } from '@/lib/types';
import { onRevalidate } from '@/lib/revalidate';
import { Loading } from '@/components/Loading';
import { StatusBadge } from '@/components/StatusBadge';
import { discountMarker } from '@/lib/discount-source';

const STATUSES: (PaymentStatus | 'all')[] = ['all', 'confirmed', 'pending', 'cancelled'];
const inr = (n: number) => '₹' + Number(n).toLocaleString('en-IN');

export default function RegistrationsList() {
  // Bookings are written by admins only; every other role reads them redacted.
  const canWrite = useCanWrite();
  const [rows, setRows] = useState<RegistrationRow[] | null>(null);
  const [status, setStatus] = useState<PaymentStatus | 'all'>('all');
  const [editions, setEditions] = useState<EditionRow[]>([]);
  const [edition, setEdition] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [q, setQ] = useState('');
  const nav = useNavigate();
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    fetchAdmin<{ editions: EditionRow[] }>('/api/admin/editions')
      .then((result) => {
        const availableEditions = result.editions ?? [];
        setEditions(availableEditions);
        const initial = availableEditions.find((item) => item.is_current) ?? availableEditions[0];
        if (initial) setEdition(initial.slug);
      })
      .catch(showApiError);
    return () => { if (searchTimer.current) clearTimeout(searchTimer.current); };
  }, []);

  function updateSearch(value: string) {
    setSearchInput(value);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => setQ(value.trim()), 300);
  }

  const load = useCallback(() => {
    const params = new URLSearchParams();
    if (status !== 'all') params.set('status', status);
    if (q) params.set('q', q);
    if (edition) params.set('edition', edition);
    fetchAdmin<{ registrations: RegistrationRow[] }>(`/api/admin/registrations?${params}`)
      .then((d) => setRows(d.registrations))
      .catch(showApiError);
  }, [status, q, edition]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { const off = onRevalidate(load); return () => { off(); }; }, [load]);

  return (
    <div className="space-y-4 p-4 md:p-6">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-bold">Registrations</h1>
        {canWrite && (
        <Link
          to="/registrations/new"
          className="ml-auto rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground"
        >
          Add registration
        </Link>
      )}
      </div>

      <div className="grid gap-2 sm:grid-cols-3">
        <input
          aria-label="Search registrations"
          value={searchInput}
          onChange={(e) => updateSearch(e.target.value)}
          placeholder="Search name / phone"
          className="w-full rounded-md border px-3 py-2 text-sm"
        />
        <select
          aria-label="Edition"
          value={edition}
          onChange={(e) => setEdition(e.target.value)}
          className="w-full rounded-md border px-3 py-2 text-sm"
        >
          {editions.map((item) => <option key={item.id} value={item.slug}>{item.slug} — {item.name}</option>)}
        </select>
        <select
          aria-label="Payment status"
          value={status}
          onChange={(e) => setStatus(e.target.value as PaymentStatus | 'all')}
          className="w-full rounded-md border px-3 py-2 text-sm"
        >
          {STATUSES.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
      </div>

      {!rows ? (
        <Loading><span className="text-sm text-muted-foreground">Loading…</span></Loading>
      ) : (
        <>
          {/* Desktop table */}
          <div className="hidden overflow-x-auto rounded-lg border md:block">
            <table className="w-full text-sm">
              <thead className="bg-muted text-left">
                <tr>
                  <th className="p-2">Name</th>
                  <th className="p-2">Phone</th>
                  <th className="p-2">Pass</th>
                  <th className="p-2">Days</th>
                  <th className="p-2">Tickets</th>
                  <th className="p-2">Status</th>
                  <th className="p-2">Amount</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr
                    key={r.id}
                    className="cursor-pointer border-t hover:bg-muted/50"
                    onClick={() => nav(`/registrations/${r.id}`)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        nav(`/registrations/${r.id}`);
                      }
                    }}
                    role="link"
                    tabIndex={0}
                  >
                    <td className="p-2">{r.users?.name || '—'}</td>
                    <td className="p-2">{r.user_phone}</td>
                    <td className="p-2">{r.pass_type}</td>
                    <td className="p-2">{r.days.join(', ')}</td>
                    <td className="p-2">{r.seats}</td>
                    <td className="p-2">
                      <StatusBadge status={r.payment_status} />
                    </td>
                    <td className="p-2">
                      <span className="whitespace-nowrap">{inr(r.amount_paid)}</span>
                      <Marker reg={r} />
                    </td>
                  </tr>
                ))}
                {rows.length === 0 && (
                  <tr>
                    <td colSpan={7} className="p-6 text-center text-sm text-muted-foreground">
                      No registrations
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {/* Mobile cards */}
          <div className="space-y-2 md:hidden">
            {rows.map((r) => (
              <button
                key={r.id}
                onClick={() => nav(`/registrations/${r.id}`)}
                className="block w-full rounded-lg border p-3 text-left"
              >
                <div className="flex items-center justify-between">
                  <span className="font-medium">{r.users?.name || '—'}</span>
                  <StatusBadge status={r.payment_status} />
                </div>
                <div className="mt-1 text-sm text-muted-foreground">{r.user_phone}</div>
                <div className="mt-1 flex items-start justify-between gap-3 text-sm">
                  <span className="min-w-0">{r.seats} ticket{r.seats === 1 ? '' : 's'} · {r.pass_type} · {r.days.join(', ')}</span>
                  <span className="shrink-0">{inr(r.amount_paid)}<Marker reg={r} /></span>
                </div>
              </button>
            ))}
            {rows.length === 0 && (
              <div className="rounded-lg border p-6 text-center text-sm text-muted-foreground">
                No registrations
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

/**
 * Why this row costs what it does, in one word.
 *
 * Only rendered when there is something to say — a full-price pass carries no
 * marker, so the column stays quiet for the common case and the ₹0 rows that
 * need explaining are the ones that stand out.
 */
function Marker({ reg }: { reg: RegistrationRow }) {
  const marker = discountMarker(reg);
  if (!marker) return null;
  return (
    <span className="ml-1.5 whitespace-nowrap rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
      {marker}
    </span>
  );
}
