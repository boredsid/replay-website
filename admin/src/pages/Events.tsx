import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import { fetchAdmin, showApiError } from '@/lib/api';
import { onRevalidate } from '@/lib/revalidate';
import { useCanManageEvents } from '@/lib/whoami';
import { bookingsToCsv, downloadCsv } from '@/lib/csv';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Loading } from '@/components/Loading';
import type { EventSession, EventsOverview } from '@/lib/types';

interface Candidate {
  attendee_id: string;
  name: string;
  phone_masked: string | null;
}

function sessionTime(session: EventSession): string {
  if (session.is_all_day) return 'All day';
  const start = session.start_time?.slice(0, 5) ?? '';
  const end = session.end_time?.slice(0, 5) ?? '';
  return end ? `${start}–${end}` : start;
}

/** Full, nearly full, or fine — the thing somebody wants at a glance. */
function fillTone(session: EventSession): string {
  if (session.capacity === null) return 'text-muted-foreground';
  if (session.seats_remaining === 0) return 'text-destructive font-medium';
  if (session.seats_remaining !== null && session.seats_remaining <= 2) return 'text-amber-600 font-medium';
  return 'text-muted-foreground';
}

/**
 * The events board.
 *
 * Three questions, one payload. The Worker returns every bookable session in
 * the edition with its confirmed list and its queue, so "how is the day going",
 * "what has this person booked" and the export are all views over the same
 * read rather than three round trips — and the per-person view, which nothing
 * answered before, is a filter.
 *
 * Reading is open to every member of staff. Changing a booking is not: only the
 * two admin roles see the controls, and the Worker refuses the request from
 * anybody else regardless. A desk role that needs to move somebody uses the
 * session roster it already owns, reachable from each session below.
 */
export default function Events() {
  const canManage = useCanManageEvents();
  const [data, setData] = useState<EventsOverview | null>(null);
  const [failed, setFailed] = useState(false);
  const [day, setDay] = useState<string>('all');
  const [expanded, setExpanded] = useState<string | null>(null);

  const [personQuery, setPersonQuery] = useState('');
  const [person, setPerson] = useState<Candidate | null>(null);
  const [candidates, setCandidates] = useState<Candidate[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [addingTo, setAddingTo] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setData(await fetchAdmin<EventsOverview>('/api/admin/events'));
      setFailed(false);
    } catch (error) {
      setFailed(true);
      showApiError(error);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);
  // Every write below goes through `fetchAdmin`, which fires this once the
  // server has answered — so booking and removing do not reload by hand, and a
  // write path added later cannot forget to.
  useEffect(() => {
    const off = onRevalidate(() => { void load(); });
    return () => { off(); };
  }, [load]);

  const days = useMemo(
    () => [...new Set((data?.sessions ?? []).map((session) => session.day))].sort(),
    [data],
  );

  const sessions = useMemo(
    () => (data?.sessions ?? []).filter((session) => day === 'all' || session.day === day),
    [data, day],
  );

  const totals = useMemo(() => {
    const all = data?.sessions ?? [];
    return {
      sessions: all.length,
      confirmed: all.reduce((sum, s) => sum + s.confirmed.length, 0),
      waiting: all.reduce((sum, s) => sum + s.waitlisted.length, 0),
      full: all.filter((s) => s.capacity !== null && s.seats_remaining === 0).length,
    };
  }, [data]);

  /**
   * What this person has booked, across the whole programme.
   *
   * Derived from the payload already loaded rather than asked for separately —
   * the answer is a filter over the rosters, not a different question.
   */
  const theirs = useMemo(() => {
    if (!person || !data) return [];
    return data.sessions
      .map((session) => {
        const confirmed = session.confirmed.findIndex((p) => p.attendee_id === person.attendee_id);
        if (confirmed !== -1) return { session, status: 'confirmed' as const, position: 0 };
        const waiting = session.waitlisted.findIndex((p) => p.attendee_id === person.attendee_id);
        if (waiting !== -1) return { session, status: 'waitlisted' as const, position: waiting + 1 };
        return null;
      })
      .filter((row): row is NonNullable<typeof row> => row !== null);
  }, [person, data]);

  async function findPerson(event: React.FormEvent) {
    event.preventDefault();
    if (personQuery.trim().length < 2) return;
    try {
      const res = await fetchAdmin<{ attendees: Candidate[] }>(
        `/api/admin/sessions/attendees?q=${encodeURIComponent(personQuery.trim())}`,
      );
      setCandidates(res.attendees);
      // One unambiguous match is the common case at a counter; skip the step.
      if (res.attendees.length === 1) { setPerson(res.attendees[0]); setCandidates(null); }
    } catch (error) {
      showApiError(error);
    }
  }

  async function book(sessionId: string, attendee: Candidate) {
    setBusy(attendee.attendee_id);
    try {
      const result = await fetchAdmin<{ status: string; queue_position: number }>('/api/admin/events/signups', {
        method: 'POST',
        body: JSON.stringify({ schedule_item_id: sessionId, attendee_id: attendee.attendee_id }),
      });
      toast.success(result.status === 'confirmed'
        ? `${attendee.name} is in`
        : `${attendee.name} is on the waitlist at #${result.queue_position}`);
      setAddingTo(null);
    } catch (error) {
      showApiError(error);
    } finally {
      setBusy(null);
    }
  }

  async function unbook(sessionId: string, attendeeId: string, name: string) {
    setBusy(attendeeId);
    try {
      const result = await fetchAdmin<{ removed: boolean; promoted_attendee_id: string | null }>(
        '/api/admin/events/signups',
        { method: 'DELETE', body: JSON.stringify({ schedule_item_id: sessionId, attendee_id: attendeeId }) },
      );
      if (!result.removed) { toast.error('They were not on this session.'); return; }
      toast.success(`${name} removed`);
      if (result.promoted_attendee_id) {
        toast.warning('Somebody moved up off the waitlist. They get a notification if they turned them on — otherwise let them know.');
      }
    } catch (error) {
      showApiError(error);
    } finally {
      setBusy(null);
    }
  }

  function exportBookings() {
    if (!data) return;
    downloadCsv(`${data.edition.slug}-event-bookings.csv`, bookingsToCsv(data.sessions));
  }

  if (failed && !data) {
    return (
      <div className="p-4 md:p-6">
        <h1 className="text-2xl font-bold">Events</h1>
        <p className="mt-2 text-sm text-muted-foreground">Could not load bookings. Try again in a moment.</p>
        <Button className="mt-4" onClick={() => void load()}>Retry</Button>
      </div>
    );
  }
  if (!data) return <Loading><span>Loading…</span></Loading>;

  return (
    <div className="space-y-6 p-4 md:p-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Events</h1>
          <p className="text-sm text-muted-foreground">
            Every bookable session in {data.edition.name}, and who is in each.
          </p>
        </div>
        <Button variant="outline" onClick={exportBookings} disabled={totals.confirmed + totals.waiting === 0}>
          Export CSV
        </Button>
      </header>

      <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          { label: 'Bookable sessions', value: totals.sessions },
          { label: 'Seats taken', value: totals.confirmed },
          { label: 'On waitlists', value: totals.waiting },
          { label: 'Full', value: totals.full },
        ].map((tile) => (
          <div key={tile.label} className="rounded-lg border bg-background p-3">
            <div className="text-2xl font-bold">{tile.value}</div>
            <div className="text-xs text-muted-foreground">{tile.label}</div>
          </div>
        ))}
      </section>

      <section className="space-y-3 rounded-lg border bg-background p-4">
        <div>
          <h2 className="font-semibold">What has someone booked?</h2>
          <p className="text-sm text-muted-foreground">
            Find an attendee to see every session they hold a seat or a place in the queue for.
          </p>
        </div>
        <form onSubmit={findPerson} className="flex gap-2">
          <Input
            value={personQuery}
            onChange={(event) => setPersonQuery(event.target.value)}
            placeholder="Phone number or name"
            aria-label="Find an attendee"
          />
          <Button type="submit">Find</Button>
          {person && (
            <Button type="button" variant="ghost" onClick={() => { setPerson(null); setCandidates(null); setPersonQuery(''); }}>
              Clear
            </Button>
          )}
        </form>

        {candidates?.length === 0 && (
          <p className="text-sm text-muted-foreground">
            Nobody matched. Attendees are findable by their own number once it has been taken at check-in.
          </p>
        )}
        {candidates && candidates.length > 0 && (
          <ul className="space-y-2">
            {candidates.map((candidate) => (
              <li key={candidate.attendee_id} className="flex items-center justify-between gap-3 rounded-md border p-2">
                <span className="text-sm">
                  {candidate.name}
                  {candidate.phone_masked && <span className="text-muted-foreground"> · {candidate.phone_masked}</span>}
                </span>
                <Button size="sm" onClick={() => { setPerson(candidate); setCandidates(null); }}>Show</Button>
              </li>
            ))}
          </ul>
        )}

        {person && (
          <div className="space-y-2 rounded-md border bg-muted/30 p-3">
            <p className="font-medium">
              {person.name}
              {person.phone_masked && <span className="font-normal text-muted-foreground"> · {person.phone_masked}</span>}
            </p>
            {theirs.length === 0
              ? <p className="text-sm text-muted-foreground">No sessions booked.</p>
              : (
                <ul className="space-y-2">
                  {theirs.map(({ session, status, position }) => (
                    <li key={session.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border bg-background p-2">
                      <span className="text-sm">
                        <span className="font-medium">{session.title}</span>
                        <span className="text-muted-foreground"> · {session.day} · {sessionTime(session)}</span>
                        {session.location && <span className="text-muted-foreground"> · {session.location}</span>}
                        {status === 'waitlisted' && (
                          <span className="ml-2 rounded bg-amber-500/15 px-1.5 py-0.5 text-xs text-amber-700">
                            waiting #{position}
                          </span>
                        )}
                      </span>
                      {canManage && (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={busy === person.attendee_id}
                          onClick={() => void unbook(session.id, person.attendee_id, person.name)}
                        >
                          Remove
                        </Button>
                      )}
                    </li>
                  ))}
                </ul>
              )}
          </div>
        )}
      </section>

      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-semibold">Across the programme</h2>
          {days.length > 1 && (
            <div className="flex gap-1">
              {['all', ...days].map((option) => (
                <button
                  key={option}
                  type="button"
                  onClick={() => setDay(option)}
                  className={`rounded-md border px-2.5 py-1 text-sm ${day === option ? 'bg-primary text-primary-foreground' : 'bg-background'}`}
                >
                  {option === 'all' ? 'All days' : option}
                </button>
              ))}
            </div>
          )}
        </div>

        {sessions.length === 0 && (
          <p className="rounded-md border bg-background p-4 text-sm text-muted-foreground">
            No sessions are set to “Book in the app” yet. Turn booking on for a session in the
            {' '}<Link to="/programme" className="underline">programme</Link>{' '}and it appears here.
          </p>
        )}

        <ul className="space-y-2">
          {sessions.map((session) => {
            const open = expanded === session.id;
            return (
              <li key={session.id} className="rounded-lg border bg-background">
                <div className="flex flex-wrap items-center justify-between gap-3 p-3">
                  <button
                    type="button"
                    onClick={() => setExpanded(open ? null : session.id)}
                    aria-expanded={open}
                    className="min-w-0 flex-1 text-left"
                  >
                    <span className="block font-medium">
                      {session.title}
                      {session.public_status !== 'published' && (
                        <span className="ml-2 rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
                          {session.public_status}
                        </span>
                      )}
                    </span>
                    <span className="block text-sm text-muted-foreground">
                      {session.day} · {sessionTime(session)}
                      {session.location && ` · ${session.location}`}
                      {session.host_name && ` · ${session.host_name}`}
                    </span>
                  </button>
                  <div className="flex items-center gap-3 text-sm">
                    <span className={fillTone(session)}>
                      {session.capacity === null
                        ? `${session.confirmed.length} in`
                        : `${session.confirmed.length} / ${session.capacity}`}
                      {session.waitlisted.length > 0 && ` · ${session.waitlisted.length} waiting`}
                    </span>
                    <Link to={`/programme/${session.id}/roster`} className="text-sm underline">Roster</Link>
                  </div>
                </div>

                {open && (
                  <div className="space-y-3 border-t p-3">
                    {canManage && (
                      addingTo === session.id
                        ? (
                          <div className="space-y-2 rounded-md border bg-muted/30 p-2">
                            <p className="text-sm">
                              {person
                                ? <>Book <span className="font-medium">{person.name}</span> into this session?</>
                                : 'Find an attendee above first, then add them here.'}
                            </p>
                            <div className="flex gap-2">
                              {person && (
                                <Button size="sm" disabled={busy === person.attendee_id} onClick={() => void book(session.id, person)}>
                                  Book them in
                                </Button>
                              )}
                              <Button size="sm" variant="ghost" onClick={() => setAddingTo(null)}>Cancel</Button>
                            </div>
                          </div>
                        )
                        : <Button size="sm" onClick={() => setAddingTo(session.id)}>Add someone</Button>
                    )}

                    <div>
                      <h3 className="mb-1 text-sm font-semibold">
                        In the session ({session.confirmed.length}{session.capacity !== null ? ` / ${session.capacity}` : ''})
                      </h3>
                      {session.confirmed.length === 0
                        ? <p className="text-sm text-muted-foreground">Nobody yet.</p>
                        : (
                          <ul className="space-y-1">
                            {session.confirmed.map((booking) => (
                              <li key={booking.attendee_id} className="flex items-center justify-between gap-3 rounded-md border p-2 text-sm">
                                <span>
                                  {booking.name}
                                  {booking.phone_masked && <span className="text-muted-foreground"> · {booking.phone_masked}</span>}
                                  {booking.promoted && <span className="ml-2 text-xs text-muted-foreground">moved up from the waitlist</span>}
                                </span>
                                {canManage && (
                                  <Button size="sm" variant="outline" disabled={busy === booking.attendee_id} onClick={() => void unbook(session.id, booking.attendee_id, booking.name)}>
                                    Remove
                                  </Button>
                                )}
                              </li>
                            ))}
                          </ul>
                        )}
                    </div>

                    <div>
                      <h3 className="mb-1 text-sm font-semibold">Waiting ({session.waitlisted.length})</h3>
                      {session.waitlisted.length === 0
                        ? <p className="text-sm text-muted-foreground">Nobody waiting.</p>
                        : (
                          <ol className="space-y-1">
                            {session.waitlisted.map((booking, index) => (
                              <li key={booking.attendee_id} className="flex items-center justify-between gap-3 rounded-md border p-2 text-sm">
                                <span>
                                  <span className="text-muted-foreground">#{index + 1}</span> {booking.name}
                                  {booking.phone_masked && <span className="text-muted-foreground"> · {booking.phone_masked}</span>}
                                </span>
                                {canManage && (
                                  <Button size="sm" variant="outline" disabled={busy === booking.attendee_id} onClick={() => void unbook(session.id, booking.attendee_id, booking.name)}>
                                    Remove
                                  </Button>
                                )}
                              </li>
                            ))}
                          </ol>
                        )}
                      {canManage && session.waitlisted.length > 0 && (
                        <p className="mt-1 text-xs text-muted-foreground">
                          Removing somebody from the session moves the person at the top of this list into their seat.
                        </p>
                      )}
                    </div>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}
