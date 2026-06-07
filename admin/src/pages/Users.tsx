import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { fetchAdmin, showApiError } from '@/lib/api';
import type { UserRow } from '@/lib/types';

export default function Users() {
  const [users, setUsers] = useState<UserRow[]>([]);
  const [q, setQ] = useState('');
  const [loading, setLoading] = useState(true);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  async function load(query: string) {
    setLoading(true);
    try {
      const qs = query ? `?q=${encodeURIComponent(query)}` : '';
      const res = await fetchAdmin<{ users: UserRow[] }>(`/api/admin/users${qs}`);
      setUsers(res.users);
    } catch (e) { showApiError(e); } finally { setLoading(false); }
  }

  useEffect(() => { load(''); }, []);

  function onSearch(v: string) {
    setQ(v);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => load(v.trim()), 300);
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
        </div>
      )}
    </div>
  );
}
