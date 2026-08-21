import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Loading } from '@/components/Loading';
import { StatusBadge } from '@/components/StatusBadge';
import { fetchAdmin, showApiError } from '@/lib/api';
import { onRevalidate } from '@/lib/revalidate';
import type { EditionRow, PartnerKind, PartnerPackageKey, PartnerRow, PaymentStatus } from '@/lib/types';

const PACKAGE_LABELS: Record<PartnerPackageKey, string> = {
  standard_booth: 'Standard booth',
  community_booth: 'Community booth',
  standard_engagement: 'Standard engagement',
  patron_engagement: 'Patron engagement',
};

const money = (value: number) => `₹${Number(value).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;

export default function Partners() {
  const [rows, setRows] = useState<PartnerRow[] | null>(null);
  const [editions, setEditions] = useState<EditionRow[]>([]);
  const [editionId, setEditionId] = useState('');
  const [status, setStatus] = useState<PaymentStatus | 'all'>('all');
  const [kind, setKind] = useState<PartnerKind | 'all'>('all');
  const [searchInput, setSearchInput] = useState('');
  const [q, setQ] = useState('');
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const navigate = useNavigate();

  useEffect(() => {
    fetchAdmin<{ editions: EditionRow[] }>('/api/admin/editions')
      .then(({ editions: items }) => {
        setEditions(items);
        const initial = items.find((edition) => edition.is_current) ?? items[0];
        if (initial) setEditionId(initial.id);
      })
      .catch(showApiError);
    return () => { if (searchTimer.current) clearTimeout(searchTimer.current); };
  }, []);

  const load = useCallback(() => {
    if (!editionId) return;
    const params = new URLSearchParams({ edition_id: editionId });
    if (status !== 'all') params.set('status', status);
    if (kind !== 'all') params.set('kind', kind);
    if (q) params.set('q', q);
    fetchAdmin<{ partners: PartnerRow[] }>(`/api/admin/partners?${params}`)
      .then((result) => setRows(result.partners))
      .catch(showApiError);
  }, [editionId, status, kind, q]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const off = onRevalidate(load);
    return () => { off(); };
  }, [load]);

  function updateSearch(value: string) {
    setSearchInput(value);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => setQ(value.trim()), 300);
  }

  return (
    <div className="space-y-4 p-4 md:p-6">
      <div className="flex flex-wrap items-start gap-3">
        <div>
          <h1 className="text-2xl font-bold">Partners</h1>
          <p className="text-sm text-muted-foreground">Booth and community-engagement purchases, contacts and payment status.</p>
        </div>
        <Link to={`/partners/new?edition_id=${encodeURIComponent(editionId)}`} className="ml-auto rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground">
          Add partner
        </Link>
      </div>

      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
        <input aria-label="Search partners" value={searchInput} onChange={(event) => updateSearch(event.target.value)} placeholder="Organisation / contact / phone" className="w-full rounded-md border px-3 py-2 text-sm" />
        <select aria-label="Edition" value={editionId} onChange={(event) => setEditionId(event.target.value)} className="w-full rounded-md border px-3 py-2 text-sm">
          {editions.map((edition) => <option key={edition.id} value={edition.id}>{edition.slug} — {edition.name}</option>)}
        </select>
        <select aria-label="Partner type" value={kind} onChange={(event) => setKind(event.target.value as PartnerKind | 'all')} className="w-full rounded-md border px-3 py-2 text-sm">
          <option value="all">All types</option>
          <option value="booth">Booths</option>
          <option value="community_engagement">Community engagement</option>
        </select>
        <select aria-label="Payment status" value={status} onChange={(event) => setStatus(event.target.value as PaymentStatus | 'all')} className="w-full rounded-md border px-3 py-2 text-sm">
          <option value="all">All statuses</option>
          <option value="pending">Pending</option>
          <option value="confirmed">Confirmed</option>
          <option value="cancelled">Cancelled</option>
        </select>
      </div>

      {!rows ? (
        <Loading><span className="text-sm text-muted-foreground">Loading…</span></Loading>
      ) : rows.length === 0 ? (
        <div className="rounded-lg border p-8 text-center text-sm text-muted-foreground">No partners match these filters.</div>
      ) : (
        <>
          <div className="hidden overflow-x-auto rounded-lg border md:block">
            <table className="w-full text-sm">
              <thead className="bg-muted text-left"><tr><th className="p-2">Organisation</th><th className="p-2">Package</th><th className="p-2">Contact</th><th className="p-2">Days</th><th className="p-2">Status</th><th className="p-2">Total</th></tr></thead>
              <tbody>
                {rows.map((partner) => (
                  <tr key={partner.id} role="link" tabIndex={0} onClick={() => navigate(`/partners/${partner.id}`)} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); navigate(`/partners/${partner.id}`); } }} className="cursor-pointer border-t hover:bg-muted/50">
                    <td className="p-2 font-medium">{partner.organization_name}</td>
                    <td className="p-2">{PACKAGE_LABELS[partner.package_key]}</td>
                    <td className="p-2"><div>{partner.contact_name}</div><div className="text-xs text-muted-foreground">{partner.phone}</div></td>
                    <td className="p-2">{partner.days.join(', ')}</td>
                    <td className="p-2"><StatusBadge status={partner.payment_status} /></td>
                    <td className="p-2">{money(partner.total_amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="space-y-2 md:hidden">
            {rows.map((partner) => (
              <button key={partner.id} onClick={() => navigate(`/partners/${partner.id}`)} className="block w-full rounded-lg border p-3 text-left">
                <div className="flex items-start justify-between gap-3"><span className="font-medium">{partner.organization_name}</span><StatusBadge status={partner.payment_status} /></div>
                <div className="mt-1 text-sm text-muted-foreground">{PACKAGE_LABELS[partner.package_key]} · {partner.days.join(', ')}</div>
                <div className="mt-2 flex justify-between text-sm"><span>{partner.contact_name}</span><span>{money(partner.total_amount)}</span></div>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
