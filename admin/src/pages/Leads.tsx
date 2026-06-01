import { useEffect, useState } from 'react';
import { fetchAdmin, showApiError } from '@/lib/api';
import type { LeadRow } from '@/lib/types';
import { Loading } from '@/components/Loading';

export default function Leads() {
  const [leads, setLeads] = useState<LeadRow[] | null>(null);
  useEffect(() => { fetchAdmin<{ leads: LeadRow[] }>('/api/admin/leads').then((d) => setLeads(d.leads)).catch(showApiError); }, []);
  if (!leads) return <Loading><span>Loading…</span></Loading>;
  return (
    <div className="space-y-4 p-4 md:p-6">
      <h1 className="text-2xl font-bold">Leads</h1>
      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full text-sm">
          <thead className="bg-muted text-left"><tr><th className="p-2">Name</th><th className="p-2">Phone</th><th className="p-2">Email</th><th className="p-2">Created</th><th className="p-2">Converted</th></tr></thead>
          <tbody>
            {leads.map((l) => (
              <tr key={l.id} className="border-t"><td className="p-2">{l.name || '—'}</td><td className="p-2">{l.phone}</td><td className="p-2">{l.email || '—'}</td><td className="p-2">{new Date(l.created_at).toLocaleDateString()}</td><td className="p-2">{l.converted_at ? '✓' : '—'}</td></tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
