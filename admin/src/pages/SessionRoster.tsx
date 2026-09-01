import { useCallback, useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { toast } from 'sonner';
import { fetchAdmin, showApiError } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Loading } from '@/components/Loading';

interface RosterPerson {
  attendee_id: string;
  name: string;
  phone_masked: string | null;
  signed_up_at: string;
  promoted: boolean;
}

interface Roster {
  session: {
    id: string;
    title: string;
    day: string;
    start_time: string | null;
    capacity: number | null;
    signup_mode: string;
    seats_remaining: number | null;
  };
  confirmed: RosterPerson[];
  waitlisted: RosterPerson[];
}

interface Candidate {
  attendee_id: string;
  name: string;
  phone_masked: string | null;
}

/**
 * Who is in a session, and the two things staff can do about it.
 *
 * The "add attendee" half is the important one: without it, declining the app
 * would mean being shut out of the programme, which turns a convenience into a
 * requirement. It runs the same booking function the app does.
 */
export default function SessionRoster() {
  const { id = '' } = useParams();
  const [roster, setRoster] = useState<Roster | null>(null);
  const [query, setQuery] = useState('');
  const [candidates, setCandidates] = useState<Candidate[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setRoster(await fetchAdmin<Roster>(`/api/admin/sessions/${id}/roster`));
    } catch (error) {
      showApiError(error);
    }
  }, [id]);

  useEffect(() => { void load(); }, [load]);

  async function search(event: React.FormEvent) {
    event.preventDefault();
    if (query.trim().length < 2) return;
    try {
      const data = await fetchAdmin<{ attendees: Candidate[] }>(
        `/api/admin/sessions/attendees?q=${encodeURIComponent(query.trim())}`,
      );
      setCandidates(data.attendees);
    } catch (error) {
      showApiError(error);
    }
  }

  async function add(attendee: Candidate) {
    setBusy(attendee.attendee_id);
    try {
      const result = await fetchAdmin<{ status: string; queue_position: number }>(
        `/api/admin/sessions/${id}/signups`,
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ attendee_id: attendee.attendee_id }) },
      );
      toast.success(result.status === 'confirmed'
        ? `${attendee.name} is in`
        : `${attendee.name} is on the waitlist at #${result.queue_position}`);
      setQuery('');
      setCandidates(null);
      await load();
    } catch (error) {
      showApiError(error);
    } finally {
      setBusy(null);
    }
  }

  async function remove(person: RosterPerson) {
    setBusy(person.attendee_id);
    try {
      const result = await fetchAdmin<{ removed: boolean; promoted_attendee_id: string | null }>(
        `/api/admin/sessions/${id}/signups`,
        { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ attendee_id: person.attendee_id }) },
      );
      if (!result.removed) { toast.error('They were not on this session.'); return; }
      toast.success(`${person.name} removed`);
      // No push notifications yet, so somebody has to actually go and tell them.
      if (result.promoted_attendee_id) {
        toast.warning('A waitlisted attendee moved up — let them know.');
      }
      await load();
    } catch (error) {
      showApiError(error);
    } finally {
      setBusy(null);
    }
  }

  if (!roster) return <Loading><span>Loading…</span></Loading>;

  const bookable = roster.session.signup_mode === 'app';

  return (
    <div className="space-y-5 p-4 md:p-6">
      <header className="space-y-1">
        <Link to="/programme" className="text-sm text-muted-foreground underline">← Programme</Link>
        <h1 className="text-2xl font-bold">{roster.session.title}</h1>
        <p className="text-sm text-muted-foreground">
          {roster.session.day}{roster.session.start_time ? ` · ${roster.session.start_time.slice(0, 5)}` : ''} ·{' '}
          {roster.session.capacity === null
            ? 'No capacity set'
            : `${roster.confirmed.length} of ${roster.session.capacity} seats taken`}
        </p>
      </header>

      {!bookable && (
        <p className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm">
          This session is not set to “Book in the app”, so attendees cannot add
          themselves. You can still add people here.
        </p>
      )}

      <section className="space-y-2">
        <h2 className="font-semibold">Add someone</h2>
        <form onSubmit={search} className="flex gap-2">
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Phone number or name"
            aria-label="Find an attendee to add"
          />
          <Button type="submit">Find</Button>
        </form>
        {candidates?.length === 0 && (
          <p className="text-sm text-muted-foreground">
            Nobody matched. Attendees are findable by their own number once it has
            been taken at check-in.
          </p>
        )}
        <ul className="space-y-2">
          {candidates?.map((c) => (
            <li key={c.attendee_id} className="flex items-center justify-between gap-3 rounded-md border p-2">
              <span className="text-sm">{c.name} {c.phone_masked && <span className="text-muted-foreground">· {c.phone_masked}</span>}</span>
              <Button size="sm" disabled={busy === c.attendee_id} onClick={() => void add(c)}>Add</Button>
            </li>
          ))}
        </ul>
      </section>

      <section className="space-y-2">
        <h2 className="font-semibold">
          In the session ({roster.confirmed.length}
          {roster.session.capacity !== null ? ` / ${roster.session.capacity}` : ''})
        </h2>
        {roster.confirmed.length === 0
          ? <p className="text-sm text-muted-foreground">Nobody yet.</p>
          : (
            <ul className="space-y-2">
              {roster.confirmed.map((p) => (
                <li key={p.attendee_id} className="flex items-center justify-between gap-3 rounded-md border p-2">
                  <span className="text-sm">
                    {p.name}
                    {p.phone_masked && <span className="text-muted-foreground"> · {p.phone_masked}</span>}
                    {p.promoted && <span className="ml-2 text-xs text-muted-foreground">moved up from the waitlist</span>}
                  </span>
                  <Button size="sm" variant="outline" disabled={busy === p.attendee_id} onClick={() => void remove(p)}>
                    Remove
                  </Button>
                </li>
              ))}
            </ul>
          )}
      </section>

      <section className="space-y-2">
        <h2 className="font-semibold">Waiting ({roster.waitlisted.length})</h2>
        {roster.waitlisted.length === 0
          ? <p className="text-sm text-muted-foreground">Nobody waiting.</p>
          : (
            <ol className="space-y-2">
              {roster.waitlisted.map((p, index) => (
                <li key={p.attendee_id} className="flex items-center justify-between gap-3 rounded-md border p-2">
                  <span className="text-sm">
                    <span className="text-muted-foreground">#{index + 1}</span> {p.name}
                    {p.phone_masked && <span className="text-muted-foreground"> · {p.phone_masked}</span>}
                  </span>
                  <Button size="sm" variant="outline" disabled={busy === p.attendee_id} onClick={() => void remove(p)}>
                    Remove
                  </Button>
                </li>
              ))}
            </ol>
          )}
        {roster.waitlisted.length > 0 && (
          <p className="text-sm text-muted-foreground">
            Removing someone from the session moves the person at the top of this
            list into their seat.
          </p>
        )}
      </section>
    </div>
  );
}
