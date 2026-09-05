import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { fetchAdmin, showApiError } from '@/lib/api';
import { useWhoAmI, type Role } from '@/lib/whoami';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ShieldAlert, Trash2, UserPlus } from 'lucide-react';

/** Kept in step with `worker/src/admin/roles.ts`; the Worker is the authority. */
const ROLE_LABELS: Record<Role, string> = {
  admin: 'Full admin',
  basic_admin: 'Basic admin',
  check_in: 'Check-in desk',
  library: 'Game library',
  programme: 'Programme & notices',
};
const ROLE_HINTS: Record<Role, string> = {
  admin: 'Everything, including this page',
  basic_admin: 'Everything except this page — cannot change who has access',
  check_in: 'Check people in, issue app codes, session rosters',
  library: 'Lend and take back games',
  programme: 'Edit the schedule and send notices',
};
const ALL_ROLES = Object.keys(ROLE_LABELS) as Role[];

interface StaffRow {
  email: string;
  name: string | null;
  roles: Role[];
  added_by: string | null;
  created_at: string;
}

type AccessSync =
  | { synced: true; members: number }
  | { synced: false; reason: 'not_configured' | 'failed'; detail?: string };

/**
 * Who may use the admin, and for what.
 *
 * Two gates sit behind this screen: Cloudflare Access decides who can reach the
 * admin at all, and the staff table decides what they may do once here. Adding
 * somebody writes the second and pushes the first, so this is the only place
 * either needs touching.
 */
export default function Staff() {
  const who = useWhoAmI();
  const [rows, setRows] = useState<StaffRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [roles, setRoles] = useState<Role[]>(['check_in']);
  const [sync, setSync] = useState<AccessSync | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await fetchAdmin<{ staff: StaffRow[] }>('/api/admin/staff');
      setRows(Array.isArray(data?.staff) ? data.staff : []);
    } catch (error) { showApiError(error); }
  }, []);

  useEffect(() => { void load(); }, [load]);

  /** Says what happened to the perimeter, which is the half that is not ours. */
  const reportSync = (result: AccessSync | undefined) => {
    if (!result) return;
    setSync(result);
    if (result.synced) return;
    if (result.reason === 'not_configured') {
      toast.warning('Saved here. Cloudflare Access is not connected, so add them there by hand.');
    } else {
      toast.error('Saved here, but Cloudflare Access did not update. They may not get in yet.');
    }
  };

  const add = async (event: React.FormEvent) => {
    event.preventDefault();
    if (roles.length === 0) { toast.error('Pick at least one thing they can do.'); return; }
    setBusy(true);
    try {
      const result = await fetchAdmin<{ ok: true; access_sync?: AccessSync }>('/api/admin/staff', {
        method: 'POST',
        body: JSON.stringify({ email: email.trim(), name: name.trim() || null, roles }),
      });
      toast.success(`${email.trim()} added`);
      reportSync(result.access_sync);
      setEmail(''); setName(''); setRoles(['check_in']);
      await load();
    } catch (error) { showApiError(error); } finally { setBusy(false); }
  };

  const setRolesFor = async (row: StaffRow, next: Role[]) => {
    if (next.length === 0) { toast.error('Everyone needs at least one role. Remove them instead.'); return; }
    setBusy(true);
    try {
      await fetchAdmin(`/api/admin/staff/${encodeURIComponent(row.email)}`, {
        method: 'PATCH',
        body: JSON.stringify({ roles: next }),
      });
      await load();
    } catch (error) { showApiError(error); } finally { setBusy(false); }
  };

  const remove = async (row: StaffRow) => {
    if (!window.confirm(`Remove ${row.email}? They lose access to the admin immediately.`)) return;
    setBusy(true);
    try {
      const result = await fetchAdmin<{ ok: true; access_sync?: AccessSync }>(
        `/api/admin/staff/${encodeURIComponent(row.email)}`, { method: 'DELETE' },
      );
      toast.success(`${row.email} removed`);
      reportSync(result.access_sync);
      await load();
    } catch (error) { showApiError(error); } finally { setBusy(false); }
  };

  const toggle = (list: Role[], role: Role) =>
    list.includes(role) ? list.filter((r) => r !== role) : [...list, role];

  return (
    <div className="space-y-6 p-4 md:p-6">
      <header className="space-y-1">
        <h1 className="font-heading text-2xl font-semibold">Staff</h1>
        <p className="text-sm text-muted-foreground">
          {rows.length} {rows.length === 1 ? 'person' : 'people'} can use the admin.
          Adding somebody here also lets them past Cloudflare Access.
        </p>
        <p className="text-sm text-muted-foreground">
          Everyone on staff can additionally <strong>read</strong> the programme,
          notices and bookings, whatever else they do. Bookings shown that way
          carry no amounts and only the last four digits of a number.
        </p>
      </header>

      {sync && !sync.synced && (
        <p className="flex items-start gap-2 rounded-lg border border-destructive/50 bg-destructive/5 p-3 text-sm">
          <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-destructive" aria-hidden="true" />
          <span>
            {sync.reason === 'not_configured'
              ? 'Cloudflare Access is not connected to this app yet, so the perimeter is still managed by hand in the dashboard.'
              : `Cloudflare Access did not update: ${sync.detail ?? 'unknown error'}. Changes here are saved, but who can reach the door has not changed.`}
          </span>
        </p>
      )}

      <form onSubmit={add} className="space-y-3 rounded-lg border p-4">
        <h2 className="flex items-center gap-2 font-heading font-semibold">
          <UserPlus className="h-4 w-4" aria-hidden="true" /> Add somebody
        </h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <Input
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="volunteer@example.com"
            aria-label="Email address"
            required
          />
          <Input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Name (optional)"
            aria-label="Name"
          />
        </div>
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">What can they do?</legend>
          {ALL_ROLES.map((role) => (
            <label key={role} className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                className="mt-1"
                checked={roles.includes(role)}
                onChange={() => setRoles((current) => toggle(current, role))}
              />
              <span>
                <span className="font-medium">{ROLE_LABELS[role]}</span>
                <span className="block text-muted-foreground">{ROLE_HINTS[role]}</span>
              </span>
            </label>
          ))}
        </fieldset>
        <Button type="submit" disabled={busy || !email.trim()}>Add</Button>
      </form>

      <ul className="space-y-2">
        {rows.map((row) => {
          const isMe = who?.email?.toLowerCase() === row.email.toLowerCase();
          return (
            <li key={row.email} className="space-y-3 rounded-lg border p-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-medium">
                    {row.name || row.email}
                    {isMe && <span className="ml-2 text-xs text-muted-foreground">(you)</span>}
                  </p>
                  {row.name && <p className="text-sm text-muted-foreground">{row.email}</p>}
                  {row.added_by && (
                    <p className="text-xs text-muted-foreground">Added by {row.added_by}</p>
                  )}
                </div>
                {/* Removing yourself is refused by the Worker too; not offering
                    it is kinder than explaining it afterwards. */}
                {!isMe && (
                  <Button size="sm" variant="ghost" disabled={busy} onClick={() => void remove(row)}>
                    <Trash2 className="mr-1 h-4 w-4" aria-hidden="true" /> Remove
                  </Button>
                )}
              </div>
              <div className="flex flex-wrap gap-3">
                {ALL_ROLES.map((role) => (
                  <label key={role} className="flex items-center gap-1.5 text-sm">
                    <input
                      type="checkbox"
                      checked={row.roles.includes(role)}
                      disabled={busy || (isMe && role === 'admin')}
                      onChange={() => void setRolesFor(row, toggle(row.roles, role))}
                    />
                    {ROLE_LABELS[role]}
                  </label>
                ))}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
