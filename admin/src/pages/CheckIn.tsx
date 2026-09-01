import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { fetchAdmin, showApiError } from '@/lib/api';
import type { CheckInAttendee, CheckInDay, CheckInRegistration } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Loading } from '@/components/Loading';
import { useOnlineStatus } from '@/lib/use-online-status';

const DAY_LABEL: Record<CheckInDay, string> = { day1: 'Sat', day2: 'Sun' };

/**
 * A fresh id per action, generated before the request leaves the device so a
 * retry after a network drop is deduplicated server-side rather than checking
 * one person in twice.
 */
function newClientEventId(): string {
  return crypto.randomUUID();
}

interface Draft {
  name: string;
  phone: string;
}

export default function CheckIn() {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<CheckInRegistration[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const searchRef = useRef<HTMLInputElement>(null);
  const online = useOnlineStatus();

  // The desk types a number the moment someone walks up; nothing else on this
  // screen deserves the cursor.
  useEffect(() => { searchRef.current?.focus(); }, []);

  const search = useCallback(async (term: string) => {
    if (term.trim().length < 2) { setResults(null); return; }
    setSearching(true);
    try {
      const data = await fetchAdmin<{ registrations: CheckInRegistration[] }>(
        `/api/admin/check-in/search?q=${encodeURIComponent(term.trim())}`,
      );
      setResults(data.registrations);
    } catch (error) {
      showApiError(error);
    } finally {
      setSearching(false);
    }
  }, []);

  function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    void search(query);
  }

  function draftFor(id: string): Draft {
    return drafts[id] ?? { name: '', phone: '' };
  }

  function setDraft(id: string, patch: Partial<Draft>) {
    setDrafts((prev) => ({ ...prev, [id]: { ...draftFor(id), ...patch } }));
  }

  async function act(
    attendee: CheckInAttendee,
    day: CheckInDay,
    kind: 'in' | 'out',
  ) {
    const draft = draftFor(attendee.attendee_id);
    setBusy(`${attendee.attendee_id}:${day}`);
    try {
      const body = await fetchAdmin<{ warning: string | null; deduped: boolean }>(
        '/api/admin/check-in',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            attendee_id: attendee.attendee_id,
            day,
            kind,
            client_event_id: newClientEventId(),
            display_name: draft.name.trim() || undefined,
            phone: draft.phone.trim() || undefined,
          }),
        },
      );
      toast.success(
        kind === 'in'
          ? `${draft.name.trim() || attendee.name} checked in · ${DAY_LABEL[day]}`
          : `${draft.name.trim() || attendee.name} checked out · ${DAY_LABEL[day]}`,
      );
      if (body.warning?.startsWith('phone_already_used_by:')) {
        // Shared numbers are normal for couples and families, so this informs
        // rather than blocks.
        toast.warning(`That number is also on ${body.warning.split(':')[1]}'s badge.`);
      }
      setDrafts((prev) => ({ ...prev, [attendee.attendee_id]: { name: '', phone: '' } }));
      await search(query);
    } catch (error) {
      showApiError(error);
    } finally {
      setBusy(null);
    }
  }

  async function undo(attendee: CheckInAttendee, day: CheckInDay) {
    const eventId = attendee.last_event[day];
    if (!eventId) return;
    setBusy(`${attendee.attendee_id}:${day}`);
    try {
      await fetchAdmin('/api/admin/check-in/undo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ event_id: eventId, client_event_id: newClientEventId() }),
      });
      toast.success(`Undone · ${attendee.name}, ${DAY_LABEL[day]}`);
      await search(query);
    } catch (error) {
      showApiError(error);
    } finally {
      setBusy(null);
    }
  }

  async function checkInAll(registration: CheckInRegistration, day: CheckInDay) {
    const pending = registration.attendees.filter(
      (a) => a.valid_days.includes(day) && a.state[day] !== 'in',
    );
    if (pending.length === 0) return;
    setBusy(`${registration.registration_id}:${day}`);
    try {
      await fetchAdmin('/api/admin/check-in/bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          entries: pending.map((a) => {
            const draft = draftFor(a.attendee_id);
            return {
              attendee_id: a.attendee_id,
              day,
              kind: 'in',
              client_event_id: newClientEventId(),
              display_name: draft.name.trim() || undefined,
              phone: draft.phone.trim() || undefined,
            };
          }),
        }),
      });
      toast.success(`${pending.length} checked in · ${DAY_LABEL[day]}`);
      await search(query);
    } catch (error) {
      showApiError(error);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">Check in</h1>
        <p className="text-sm text-muted-foreground">
          Search the purchaser’s phone number. You can also search an attendee’s own
          number or name.
        </p>
      </header>

      {!online && (
        <p className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm">
          You’re offline. Check-ins can’t be saved until the connection returns.
        </p>
      )}

      <form onSubmit={onSubmit} className="flex gap-2">
        <Input
          ref={searchRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Phone number or name"
          inputMode="text"
          autoComplete="off"
          aria-label="Search by purchaser phone, attendee phone, or name"
        />
        <Button type="submit" disabled={searching}>Search</Button>
      </form>

      {searching && <Loading><span>Searching…</span></Loading>}

      {results?.length === 0 && (
        <p className="text-sm text-muted-foreground">
          Nobody matched. Try the purchaser’s number, or the name on the booking.
        </p>
      )}

      <div className="space-y-4">
        {results?.map((registration) => (
          <section
            key={registration.registration_id}
            className="rounded-lg border p-4 space-y-4"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="text-sm text-muted-foreground">
                {registration.purchaser_phone_masked} · {registration.pass_type} ·{' '}
                {registration.days.map((d) => DAY_LABEL[d]).join(' + ')} ·{' '}
                {registration.seats} {registration.seats === 1 ? 'seat' : 'seats'}
              </div>
              {registration.attendees.length > 1 && (
                <div className="flex gap-2">
                  {registration.days.map((day) => (
                    <Button
                      key={day}
                      size="sm"
                      variant="secondary"
                      disabled={busy !== null || !online}
                      onClick={() => void checkInAll(registration, day)}
                    >
                      Check in all · {DAY_LABEL[day]}
                    </Button>
                  ))}
                </div>
              )}
            </div>

            <ul className="space-y-4">
              {registration.attendees.map((attendee) => (
                <li key={attendee.attendee_id} className="rounded-md border p-3 space-y-3">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <span className="font-medium">
                      {attendee.name}
                      {attendee.is_purchaser && (
                        <span className="ml-2 text-xs text-muted-foreground">purchaser</span>
                      )}
                    </span>
                    {attendee.phone_masked && (
                      <span className="text-xs text-muted-foreground">{attendee.phone_masked}</span>
                    )}
                  </div>

                  {/* Prompted, never required: an unnamed guest still checks in. */}
                  {(!attendee.has_name || !attendee.has_phone) && (
                    <div className="flex flex-wrap gap-2">
                      {!attendee.has_name && (
                        <Input
                          className="max-w-[12rem]"
                          value={draftFor(attendee.attendee_id).name}
                          onChange={(e) => setDraft(attendee.attendee_id, { name: e.target.value })}
                          placeholder="Name (optional)"
                          aria-label={`Name for seat ${attendee.seat_index}`}
                        />
                      )}
                      {!attendee.has_phone && (
                        <Input
                          className="max-w-[12rem]"
                          value={draftFor(attendee.attendee_id).phone}
                          onChange={(e) => setDraft(attendee.attendee_id, { phone: e.target.value })}
                          placeholder="Phone (optional)"
                          inputMode="numeric"
                          aria-label={`Phone for seat ${attendee.seat_index}`}
                        />
                      )}
                    </div>
                  )}

                  <div className="flex flex-wrap gap-2">
                    {(['day1', 'day2'] as CheckInDay[]).map((day) => {
                      const covered = attendee.valid_days.includes(day);
                      const state = attendee.state[day];
                      const key = `${attendee.attendee_id}:${day}`;
                      if (!covered) {
                        return (
                          <Button key={day} size="sm" variant="outline" disabled
                            title={`${DAY_LABEL[day]} is not on this ticket`}>
                            {DAY_LABEL[day]} · not on ticket
                          </Button>
                        );
                      }
                      return (
                        <span key={day} className="flex items-center gap-1">
                          <Button
                            size="sm"
                            variant={state === 'in' ? 'secondary' : 'default'}
                            disabled={busy === key || !online}
                            onClick={() => void act(attendee, day, state === 'in' ? 'out' : 'in')}
                          >
                            {state === 'in' ? `Check out · ${DAY_LABEL[day]}` : `Check in · ${DAY_LABEL[day]}`}
                          </Button>
                          {attendee.last_event[day] && (
                            <Button
                              size="sm"
                              variant="ghost"
                              disabled={busy === key || !online}
                              onClick={() => void undo(attendee, day)}
                              aria-label={`Undo last ${DAY_LABEL[day]} action for ${attendee.name}`}
                            >
                              Undo
                            </Button>
                          )}
                        </span>
                      );
                    })}
                  </div>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}
