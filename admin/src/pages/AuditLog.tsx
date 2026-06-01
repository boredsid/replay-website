import { useEffect, useState } from 'react';
import { fetchAdmin, showApiError } from '@/lib/api';
import type { AuditEntry } from '@/lib/types';
import { Loading } from '@/components/Loading';

export default function AuditLog() {
  const [entries, setEntries] = useState<AuditEntry[] | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  useEffect(() => { fetchAdmin<{ entries: AuditEntry[] }>('/api/admin/audit').then((d) => setEntries(d.entries)).catch(showApiError); }, []);
  if (!entries) return <Loading><span>Loading…</span></Loading>;
  return (
    <div className="space-y-4 p-4 md:p-6">
      <h1 className="text-2xl font-bold">Audit log</h1>
      <div className="space-y-2">
        {entries.map((e) => (
          <div key={e.id} className="rounded-lg border p-3 text-sm">
            <div className="flex flex-wrap gap-2">
              <span className="font-medium">{e.action}</span>
              <span className="text-muted-foreground">{e.target_table}{e.target_id ? ` / ${e.target_id}` : ''}</span>
              <span className="ml-auto text-muted-foreground">{new Date(e.created_at).toLocaleString()}</span>
            </div>
            <div className="text-xs text-muted-foreground">{e.actor_email}</div>
            {e.diff != null && (
              <button onClick={() => setOpen(open === e.id ? null : e.id)} className="mt-1 text-xs underline">{open === e.id ? 'hide' : 'diff'}</button>
            )}
            {open === e.id && <pre className="mt-2 overflow-x-auto rounded bg-muted p-2 text-xs">{JSON.stringify(e.diff, null, 2)}</pre>}
          </div>
        ))}
      </div>
    </div>
  );
}
