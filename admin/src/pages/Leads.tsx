import { useCallback, useEffect, useState } from 'react';
import { fetchAdmin, showApiError } from '@/lib/api';
import type { EditionRow, LeadRow } from '@/lib/types';
import { Loading } from '@/components/Loading';
import { toCsv, downloadCsv } from '@/lib/csv';
import { leadWhatsappUrl } from '@/lib/whatsapp';

type ConversionFilter = 'active' | 'all' | 'converted';

const CSV_HEADERS = ['name', 'phone', 'edition', 'step_reached', 'converted_at', 'created_at'] as const;

function leadsToCsv(leads: LeadRow[]): string {
  return toCsv(
    CSV_HEADERS,
    leads.map((l) => [
      l.name ?? '',
      l.phone,
      l.editions?.slug ?? 'untagged',
      l.step_reached ?? '',
      l.converted_at ?? '',
      l.created_at,
    ]),
  );
}

export default function Leads() {
  const [leads, setLeads] = useState<LeadRow[] | null>(null);
  const [editions, setEditions] = useState<EditionRow[]>([]);
  const [edition, setEdition] = useState('all');
  const [conversion, setConversion] = useState<ConversionFilter>('active');

  useEffect(() => {
    fetchAdmin<{ editions: EditionRow[] }>('/api/admin/editions')
      .then((result) => setEditions(result.editions ?? []))
      .catch(showApiError);
  }, []);

  const load = useCallback(() => {
    const params = new URLSearchParams({ edition, conversion });
    setLeads(null);
    fetchAdmin<{ leads: LeadRow[] }>(`/api/admin/leads?${params}`)
      .then((result) => setLeads(result.leads))
      .catch(showApiError);
  }, [conversion, edition]);

  useEffect(() => { load(); }, [load]);

  function exportCsv() {
    if (!leads?.length) return;
    const stamp = new Date().toISOString().slice(0, 10);
    downloadCsv(`replay-leads-${stamp}.csv`, leadsToCsv(leads));
  }

  if (!leads) return <Loading><span>Loading…</span></Loading>;
  return (
    <div className="space-y-4 p-4 md:p-6">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-bold">Leads</h1>
        <button
          type="button"
          onClick={exportCsv}
          disabled={leads.length === 0}
          className="ml-auto rounded-md border px-3 py-1.5 text-sm font-medium disabled:opacity-50"
        >Export CSV</button>
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        <select
          aria-label="Edition"
          value={edition}
          onChange={(event) => setEdition(event.target.value)}
          className="w-full rounded-md border bg-background px-3 py-2 text-sm"
        >
          <option value="all">All editions</option>
          <option value="untagged">Untagged</option>
          {editions.map((item) => <option key={item.id} value={item.slug}>{item.slug} — {item.name}</option>)}
        </select>
        <select
          aria-label="Conversion status"
          value={conversion}
          onChange={(event) => setConversion(event.target.value as ConversionFilter)}
          className="w-full rounded-md border bg-background px-3 py-2 text-sm"
        >
          <option value="active">Open leads</option>
          <option value="all">All leads</option>
          <option value="converted">Converted</option>
        </select>
      </div>
      <div className="hidden overflow-x-auto rounded-lg border md:block">
        <table className="w-full text-sm">
          <thead className="bg-muted text-left"><tr><th className="p-2">Name</th><th className="p-2">Phone</th><th className="p-2">Edition</th><th className="p-2">Step</th><th className="p-2">Status</th><th className="p-2">Created</th><th className="p-2 text-right">Reach out</th></tr></thead>
          <tbody>
            {leads.map((l) => (
              <tr key={l.id} className="border-t">
                <td className="p-2">{l.name || '—'}</td>
                <td className="p-2">{l.phone}</td>
                <td className="p-2">{l.editions?.slug || 'Untagged'}</td>
                <td className="p-2">{l.step_reached || '—'}</td>
                <td className="p-2">{l.converted_at ? 'Converted' : 'Open'}</td>
                <td className="p-2">{new Date(l.created_at).toLocaleDateString()}</td>
                <td className="p-2 text-right">
                  <a
                    href={leadWhatsappUrl(l.phone, l.name)}
                    target="_blank"
                    rel="noreferrer noopener"
                    aria-label={`Message ${l.name || l.phone} on WhatsApp`}
                    className="inline-block rounded-md bg-primary px-2 py-1 text-xs font-medium text-primary-foreground"
                  >WhatsApp</a>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="space-y-2 md:hidden">
        {leads.map((lead) => (
          <div key={lead.id} className="rounded-lg border bg-background p-3 text-sm">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="font-medium">{lead.name || 'Unnamed lead'}</div>
                <div className="font-mono text-muted-foreground">{lead.phone}</div>
              </div>
              <span className="shrink-0 rounded-full border px-2 py-0.5 text-xs">{lead.converted_at ? 'Converted' : 'Open'}</span>
            </div>
            <div className="mt-2 flex items-center justify-between gap-3 text-xs text-muted-foreground">
              <span>{lead.editions?.slug || 'Untagged'} · {lead.step_reached || 'unknown'} · {new Date(lead.created_at).toLocaleDateString()}</span>
              <a
                href={leadWhatsappUrl(lead.phone, lead.name)}
                target="_blank"
                rel="noreferrer noopener"
                aria-label={`Message ${lead.name || lead.phone} on WhatsApp`}
                className="rounded-md bg-primary px-2 py-1 text-xs font-medium text-primary-foreground"
              >WhatsApp</a>
            </div>
          </div>
        ))}
        {leads.length === 0 && <div className="rounded-lg border p-6 text-center text-sm text-muted-foreground">No unregistered leads.</div>}
      </div>
    </div>
  );
}
