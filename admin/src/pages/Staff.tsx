import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import { fetchAdmin, showApiError } from '@/lib/api';
import { useWhoAmI, type Role } from '@/lib/whoami';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ShieldAlert, Trash2, UserPlus } from 'lucide-react';
import {
  ALL_ROLES, ROLE_HINTS, ROLE_LABELS, orderRoles, reconcileRoles, sameRoles,
} from '@/lib/staff-roles';
import type { ScheduleItemRow } from '@/lib/types';

interface StaffRow {
  email: string;
  name: string | null;
  roles: Role[];
  /** The sessions they run. Only meaningful while they hold `event_manager`. */
  events: string[];
  added_by: string | null;
  created_at: string;
}

/** Two sets of session ids, compared as sets rather than as arrays. */
function sameEvents(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  const right = new Set(b);
  return a.every((id) => right.has(id));
}

function sessionLabel(item: ScheduleItemRow): string {
  const when = item.is_all_day ? 'all day' : (item.start_time?.slice(0, 5) ?? '');
  return `${item.day} · ${when}${item.location ? ` · ${item.location}` : ''}`;
}

/**
 * The sessions an event manager may be given.
 *
 * Ticking boxes rather than a search field: an edition has a couple of dozen
 * bookable sessions, which is a list somebody reads, not one they query. Only
 * sessions set to "Book in the app" appear, because those are the only ones the
 * events board shows — assigning anything else would be a grant over a page
 * that stays empty.
 */
function EventPicker({ sessions, chosen, onToggle, disabled, failed }: {
  sessions: ScheduleItemRow[];
  chosen: readonly string[];
  onToggle: (id: string) => void;
  disabled?: boolean;
  /** The programme could not be read, which is not the same as it being empty. */
  failed?: boolean;
}) {
  return (
    <fieldset className="space-y-2 rounded-md border bg-muted/30 p-3">
      <legend className="px-1 text-sm font-medium">Which events are theirs?</legend>
      {failed
        ? (
          <p className="text-sm text-muted-foreground">
            The programme could not be read, so there is nothing to choose from. Reload the
            page, and check there is a current edition.
          </p>
        )
        : sessions.length === 0
        ? (
          <p className="text-sm text-muted-foreground">
            No session is set to “Book in the app” yet. Turn booking on for one in the
            {' '}<Link to="/programme" className="underline">programme</Link>{' '}and it can be
            handed over here.
          </p>
        )
        : (
          <>
            <p className="text-sm text-muted-foreground">
              They see and change the bookings for these, and nothing else anywhere in the admin.
              With none ticked they can do nothing at all.
            </p>
            <div className="max-h-64 space-y-1 overflow-y-auto">
              {sessions.map((item) => (
                <label key={item.id} className="flex items-start gap-2 rounded-md p-1 text-sm hover:bg-background">
                  <input
                    type="checkbox"
                    className="mt-1"
                    checked={chosen.includes(item.id)}
                    disabled={disabled}
                    onChange={() => onToggle(item.id)}
                  />
                  <span>
                    <span className="font-medium">{item.title}</span>
                    <span className="block text-muted-foreground">{sessionLabel(item)}</span>
                  </span>
                </label>
              ))}
            </div>
          </>
        )}
    </fieldset>
  );
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
  const [newEvents, setNewEvents] = useState<string[]>([]);
  const [sync, setSync] = useState<AccessSync | null>(null);
  // Edits in progress, per person. Checkboxes change these; nothing is sent
  // until Update, so changing somebody from admin to two desks is one request
  // and one audit row rather than three of each.
  const [drafts, setDrafts] = useState<Record<string, Role[]>>({});
  const [eventDrafts, setEventDrafts] = useState<Record<string, string[]>>({});
  const [sessions, setSessions] = useState<ScheduleItemRow[]>([]);
  const [sessionsFailed, setSessionsFailed] = useState(false);

  const load = useCallback(async () => {
    try {
      const data = await fetchAdmin<{ staff: StaffRow[] }>('/api/admin/staff');
      setRows(Array.isArray(data?.staff) ? data.staff : []);
    } catch (error) { showApiError(error); }
  }, []);

  useEffect(() => { void load(); }, [load]);

  // Loaded once whether or not anybody is an event manager yet. A separate
  // request the moment the box is ticked would make the picker appear empty for
  // the second it takes to arrive, which reads as "there are no sessions".
  useEffect(() => {
    void (async () => {
      try {
        const data = await fetchAdmin<{ items: ScheduleItemRow[] }>('/api/admin/schedule');
        setSessions((data.items ?? []).filter((item) => item.signup_mode === 'app'));
        setSessionsFailed(false);
      } catch {
        // No toast: this is furniture for one role's picker, and a page about
        // staff should not open with an error about editions when there is no
        // current one. The picker says so itself, where it is relevant.
        setSessionsFailed(true);
      }
    })();
  }, []);

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
        body: JSON.stringify({
          email: email.trim(), name: name.trim() || null, roles,
          events: roles.includes('event_manager') ? newEvents : [],
        }),
      });
      toast.success(`${email.trim()} added`);
      reportSync(result.access_sync);
      setEmail(''); setName(''); setRoles(['check_in']); setNewEvents([]);
      await load();
    } catch (error) { showApiError(error); } finally { setBusy(false); }
  };

  /** What the checkboxes for this person currently show. */
  const draftFor = (row: StaffRow): Role[] => drafts[row.email] ?? orderRoles(row.roles);
  const eventsFor = (row: StaffRow): string[] => eventDrafts[row.email] ?? row.events ?? [];

  const toggleDraft = (row: StaffRow, role: Role) => {
    setDrafts((current) => ({
      ...current,
      [row.email]: orderRoles(reconcileRoles(draftFor(row), role)),
    }));
  };

  const toggleEvent = (row: StaffRow, id: string) => {
    const mine = eventsFor(row);
    setEventDrafts((current) => ({
      ...current,
      [row.email]: mine.includes(id) ? mine.filter((other) => other !== id) : [...mine, id],
    }));
  };

  /** Forgets both drafts for one person, saved or abandoned. */
  const clearDraft = (email: string) => {
    setDrafts((current) => { const { [email]: _roles, ...rest } = current; return rest; });
    setEventDrafts((current) => { const { [email]: _events, ...rest } = current; return rest; });
  };

  const saveRoles = async (row: StaffRow) => {
    const next = draftFor(row);
    if (next.length === 0) { toast.error('Everyone needs at least one role. Remove them instead.'); return; }
    setBusy(true);
    try {
      await fetchAdmin(`/api/admin/staff/${encodeURIComponent(row.email)}`, {
        method: 'PATCH',
        // Sent whether or not they are an event manager: the Worker clears the
        // set when the role goes, and saying so here keeps the two in step.
        body: JSON.stringify({ roles: next, events: next.includes('event_manager') ? eventsFor(row) : [] }),
      });
      toast.success(`${row.name || row.email} updated`);
      clearDraft(row.email);
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
          carry no amounts and only the last four digits of a number. The one
          exception is <strong>Event manager</strong>: it opens the events you
          give them and nothing else in here, not even to look at.
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
                onChange={() => setRoles((current) => orderRoles(reconcileRoles(current, role)))}
              />
              <span>
                <span className="font-medium">{ROLE_LABELS[role]}</span>
                <span className="block text-muted-foreground">{ROLE_HINTS[role]}</span>
              </span>
            </label>
          ))}
        </fieldset>
        {roles.includes('event_manager') && (
          <EventPicker
            sessions={sessions}
            failed={sessionsFailed}
            chosen={newEvents}
            disabled={busy}
            onToggle={(id) => setNewEvents((current) => (
              current.includes(id) ? current.filter((other) => other !== id) : [...current, id]
            ))}
          />
        )}
        <Button type="submit" disabled={busy || !email.trim()}>Add</Button>
      </form>

      <ul className="space-y-2">
        {rows.map((row) => {
          const isMe = who?.email?.toLowerCase() === row.email.toLowerCase();
          const draft = draftFor(row);
          const events = eventsFor(row);
          // Either half counts as a change: moving somebody from one tournament
          // to another leaves their roles alone and is still an edit to save.
          const changed = !sameRoles(draft, row.roles)
            || (draft.includes('event_manager') && !sameEvents(events, row.events ?? []));
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
              <div className="flex flex-wrap items-center gap-3">
                {ALL_ROLES.map((role) => (
                  <label key={role} className="flex items-center gap-1.5 text-sm">
                    <input
                      type="checkbox"
                      checked={draft.includes(role)}
                      disabled={busy || (isMe && role === 'admin')}
                      onChange={() => toggleDraft(row, role)}
                    />
                    {ROLE_LABELS[role]}
                  </label>
                ))}
                {/* Disabled until something actually changed, so the button is
                    a statement about this row rather than decoration. */}
                <Button
                  size="sm"
                  className="ml-auto"
                  disabled={busy || !changed || draft.length === 0}
                  onClick={() => void saveRoles(row)}
                >
                  Update
                </Button>
                {changed && (
                  <Button size="sm" variant="ghost" disabled={busy} onClick={() => clearDraft(row.email)}>
                    Cancel
                  </Button>
                )}
              </div>
              {draft.includes('event_manager') && (
                <EventPicker
                  sessions={sessions}
                  failed={sessionsFailed}
                  chosen={events}
                  disabled={busy}
                  onToggle={(id) => toggleEvent(row, id)}
                />
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
