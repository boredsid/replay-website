import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { fetchAdmin, showApiError } from '@/lib/api';
import { onRevalidate } from '@/lib/revalidate';
import type { UserRow } from '@/lib/types';

export default function Users() {
  const PAGE_SIZE = 50;
  const [users, setUsers] = useState<UserRow[]>([]);
  const [q, setQ] = useState('');
  const [loading, setLoading] = useState(true);
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  async function load(query: string, nextOffset = offset) {
    setLoading(true);
    try {
      const params = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String(nextOffset) });
      if (query) params.set('q', query);
      const res = await fetchAdmin<{ users: UserRow[]; has_more: boolean }>(`/api/admin/users?${params}`);
      setUsers(res.users);
      setHasMore(res.has_more);
      setOffset(nextOffset);
    } catch (e) { showApiError(e); } finally { setLoading(false); }
  }

  useEffect(() => { load('', 0); }, []);

  const qRef = useRef('');
  useEffect(() => { qRef.current = q; }, [q]);
  useEffect(() => {
    const off = onRevalidate(() => load(qRef.current, offset));
    return () => { off(); };
  }, [offset]);

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  function onSearch(v: string) {
    setQ(v);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => load(v.trim(), 0), 300);
  }

  return (
    <div className="p-6">
      <h1 className="mb-4 text-2xl font-bold">Users</h1>
      <input
        aria-label="Search users"
        placeholder="Search by phone or name…"
        value={q}
        onChange={(e) => onSearch(e.target.value)}
        className="mb-4 w-full max-w-sm rounded-md border px-3 py-2"
      />
      {loading ? (
        <div className="text-muted-foreground">Loading…</div>
      ) : (
        <div className="space-y-2">
          {users.map((u) => (
            <Link key={u.phone} to={`/users/${u.phone}`} className="flex items-center justify-between rounded-md border p-4 hover:bg-muted">
              <div>
                <div className="font-medium">{u.name || <span className="text-muted-foreground">(no name)</span>}</div>
                <div className="font-mono text-sm text-muted-foreground">{u.phone}{u.email ? ` · ${u.email}` : ''}</div>
              </div>
              <div className="text-sm text-muted-foreground">{u.registration_count} reg{u.registration_count === 1 ? '' : 's'}</div>
            </Link>
          ))}
          {users.length === 0 && <div className="text-muted-foreground">No users found.</div>}
          <div className="flex items-center justify-between pt-2">
            <button
              disabled={loading || offset === 0}
              onClick={() => load(q.trim(), Math.max(0, offset - PAGE_SIZE))}
              className="rounded-md border px-3 py-2 text-sm disabled:opacity-50"
            >
              Previous
            </button>
            <span className="text-sm text-muted-foreground">Showing {offset + 1}–{offset + users.length}</span>
            <button
              disabled={loading || !hasMore}
              onClick={() => load(q.trim(), offset + PAGE_SIZE)}
              className="rounded-md border px-3 py-2 text-sm disabled:opacity-50"
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
