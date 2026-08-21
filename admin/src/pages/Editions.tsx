import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { fetchAdmin, showApiError } from '@/lib/api';
import { onRevalidate } from '@/lib/revalidate';
import type { EditionRow } from '@/lib/types';

export default function Editions() {
  const [editions, setEditions] = useState<EditionRow[]>([]);
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    try {
      const res = await fetchAdmin<{ editions: EditionRow[] }>('/api/admin/editions');
      setEditions(res.editions);
    } catch (e) { showApiError(e); } finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);
  useEffect(() => { const off = onRevalidate(load); return () => { off(); }; }, []);

  return (
    <div className="p-4 md:p-6">
      <div className="mb-4 flex items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">Editions</h1>
        <Link to="/editions/new" className="rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground">
          New edition
        </Link>
      </div>
      {loading ? (
        <div className="text-muted-foreground">Loading…</div>
      ) : (
        <div className="space-y-2">
          {editions.map((e) => (
            <Link
              key={e.id}
              to={`/editions/${e.id}`}
              className="flex flex-col items-start justify-between gap-3 rounded-md border p-4 hover:bg-muted sm:flex-row sm:items-center"
            >
              <div className="min-w-0">
                <div className="font-mono text-sm text-muted-foreground">{e.slug}</div>
                <div className="font-medium">{e.name}</div>
                <div className="break-words text-sm text-muted-foreground">{e.start_date} → {e.end_date} · {e.venue}</div>
              </div>
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <span className="rounded-full border px-2 py-0.5">{e.registration_status}</span>
                {e.is_current && <span className="rounded-full bg-primary/10 px-2 py-0.5">current</span>}
                {e.is_published ? <span className="rounded-full bg-green-100 px-2 py-0.5">published</span> : <span className="rounded-full bg-muted px-2 py-0.5">draft</span>}
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
