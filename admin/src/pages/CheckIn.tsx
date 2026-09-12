import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { ApiError, fetchAdmin, showApiError } from '@/lib/api';
import type {
  CheckInAttendee,
  CheckInDay,
  CheckInDayTotals,
  CheckInRegistration,
  CheckInTotals,
  PairingCode,
  RosterRow,
} from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Loading } from '@/components/Loading';
import PairingCodePanel from '@/components/PairingCodePanel';
import { downloadCsv, rosterToCsv } from '@/lib/csv';
import { useOnlineStatus } from '@/lib/use-online-status';
import {
  flushQueue,
  indexedDbStore,
  isPermanentFailure,
  type QueuedCheckIn,
} from '@/lib/check-in-queue';

const DAY_LABEL: Record<CheckInDay, string> = { day1: 'Sat', day2: 'Sun' };
const DAY_NAME: Record<CheckInDay, string> = { day1: 'Saturday', day2: 'Sunday' };

/** How often the tally re-reads, so a second desk's arrivals show up here. */
const TOTALS_POLL_MS = 60_000;

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

const EMPTY_DRAFT: Draft = { name: '', phone: '' };

/**
 * What still has to be collected before this seat can be checked in, or null if
 * nothing does.
 *
 * A guest seat was bought by somebody else and carries no identity of its own,
 * so the door is the only moment anyone can attach one — a seat that gets
 * through anonymously stays "Guest 2" for the rest of the event. Details already
 * on the seat count, so nobody is asked twice.
 *
 * The purchaser is exempt, and so is checking someone *out*: refusing to record
 * a departure does not produce a name, it produces a wrong occupancy count. The
 * Worker enforces exactly the same three rules — this is here so the desk sees
 * the reason on the button instead of a rejection after the fact.
 */
export function missingIdentity(
  attendee: Pick<CheckInAttendee, 'has_name' | 'has_phone' | 'is_purchaser'>,
  draft: Draft,
): string | null {
  if (attendee.is_purchaser) return null;
  const hasName = attendee.has_name || draft.name.trim().length > 0;
  // Ten digits after the country code and any spacing, matching the Worker.
  const hasPhone = attendee.has_phone || draft.phone.replace(/\D/g, '').length >= 10;
  if (!hasName && !hasPhone) return 'Needs a name and a phone number';
  if (!hasName) return 'Needs a name';
  if (!hasPhone) return 'Needs a 10-digit phone number';
  return null;
}

export default function CheckIn() {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<CheckInRegistration[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [queued, setQueued] = useState(0);
  const [exporting, setExporting] = useState(false);
  const [codes, setCodes] = useState<Record<string, PairingCode>>({});
  const [totals, setTotals] = useState<CheckInTotals | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const online = useOnlineStatus();

  // The desk types a number the moment someone walks up; nothing else on this
  // screen deserves the cursor.
  useEffect(() => { searchRef.current?.focus(); }, []);

  const flush = useCallback(async () => {
    try {
      const outcome = await flushQueue(indexedDbStore, async (entry: QueuedCheckIn) => {
        try {
          await fetchAdmin(entry.path, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(entry.body),
          });
          return { ok: true as const };
        } catch (error) {
          const status = error instanceof ApiError ? error.status : 0;
          return isPermanentFailure(status)
            ? { ok: false as const, permanent: true as const, error: (error as Error).message }
            : { ok: false as const, permanent: false as const };
        }
      });
      setQueued(outcome.remaining);
      if (outcome.sent > 0) toast.success(`${outcome.sent} queued check-in${outcome.sent === 1 ? '' : 's'} saved`);
      for (const { error } of outcome.rejected) {
        // Dropped rather than retried forever, so the operator has to see it.
        toast.error(`A queued check-in was refused: ${error}`);
      }
    } catch {
      // A failed flush is not worth interrupting the desk over; the entries stay
      // queued and the next reconnect tries again.
    }
  }, []);

  // Drain on load and whenever the network comes back.
  useEffect(() => { void flush(); }, [flush]);
  useEffect(() => { if (online) void flush(); }, [online, flush]);

  const enqueue = useCallback(async (path: string, body: Record<string, unknown>) => {
    await indexedDbStore.add({
      client_event_id: String(body.client_event_id),
      path,
      body,
      queued_at: new Date().toISOString(),
      attempts: 0,
    });
    setQueued((n) => n + 1);
  }, []);

  /**
   * Sends now, or queues if the network is not cooperating. The id travels with
   * the body either way, so a queued action replayed later is deduplicated
   * server-side rather than checking someone in twice.
   */
  const submit = useCallback(async <T,>(
    path: string,
    body: Record<string, unknown>,
  ): Promise<{ queued: boolean; data?: T }> => {
    if (!online) {
      await enqueue(path, body);
      return { queued: true };
    }
    try {
      const data = await fetchAdmin<T>(path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      return { queued: false, data };
    } catch (error) {
      const status = error instanceof ApiError ? error.status : 0;
      if (isPermanentFailure(status)) throw error;
      await enqueue(path, body);
      return { queued: true };
    }
  }, [enqueue, online]);

  /**
   * The day's tally. Failures are swallowed on purpose: this is context, not
   * the job, and a toast every time a tablet's signal dips would train the desk
   * to dismiss toasts that matter. The last good figure stays on screen, and
   * the banner below already says when something is queued rather than counted.
   */
  const loadTotals = useCallback(async () => {
    try {
      setTotals(await fetchAdmin<CheckInTotals>('/api/admin/check-in/totals'));
    } catch {
      // Keep whatever was last known.
    }
  }, []);

  useEffect(() => { void loadTotals(); }, [loadTotals]);

  useEffect(() => {
    if (!online) return;
    const timer = setInterval(() => { void loadTotals(); }, TOTALS_POLL_MS);
    return () => clearInterval(timer);
  }, [online, loadTotals]);

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

  /** After anything that changes a seat: the card the desk is looking at, and
   *  the tally it is judged against, must not disagree. */
  const refresh = useCallback(async (term: string) => {
    await Promise.all([search(term), loadTotals()]);
  }, [search, loadTotals]);

  function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    void search(query);
  }

  /**
   * The paper fallback. Pull it before doors open — once the network is down is
   * too late, and a printed sheet is the only thing that still works when the
   * tablet does not.
   */
  async function exportRoster() {
    setExporting(true);
    try {
      const data = await fetchAdmin<{ roster: RosterRow[] }>('/api/admin/check-in/roster');
      if (!data.roster.length) { toast.error('No confirmed attendees to export yet.'); return; }
      const stamp = new Date().toISOString().slice(0, 10);
      downloadCsv(`replay-roster-${stamp}.csv`, rosterToCsv(data.roster));
      toast.success(`${data.roster.length} attendees exported`);
    } catch (error) {
      showApiError(error);
    } finally {
      setExporting(false);
    }
  }

  /**
   * Hands one attendee a code for the app.
   *
   * Separate from checking them in on purpose: the desk is busy on arrival and
   * most people just want to get inside, so this is pressed when someone asks —
   * including hours later, as often as they like.
   */
  async function issueCode(attendee: CheckInAttendee) {
    setBusy(`${attendee.attendee_id}:code`);
    try {
      const code = await fetchAdmin<PairingCode>('/api/admin/check-in/pairing-code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ attendee_id: attendee.attendee_id }),
      });
      setCodes((prev) => ({ ...prev, [attendee.attendee_id]: code }));
    } catch (error) {
      showApiError(error);
    } finally {
      setBusy(null);
    }
  }

  function draftFor(id: string): Draft {
    return drafts[id] ?? EMPTY_DRAFT;
  }

  function gapFor(attendee: CheckInAttendee): string | null {
    return missingIdentity(attendee, draftFor(attendee.attendee_id));
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
    const who = draft.name.trim() || attendee.name;

    // The button is disabled in this state, so this only catches a stale render
    // — but an anonymous guest must never reach the offline queue, where the
    // refusal would surface minutes later with nobody standing at the desk.
    if (kind === 'in') {
      const gap = missingIdentity(attendee, draft);
      if (gap) { toast.error(`${attendee.name}: ${gap.toLowerCase()} before checking in.`); return; }
    }

    setBusy(`${attendee.attendee_id}:${day}`);
    try {
      const result = await submit<{ warning?: string | null }>('/api/admin/check-in', {
        attendee_id: attendee.attendee_id,
        day,
        kind,
        client_event_id: newClientEventId(),
        display_name: draft.name.trim() || undefined,
        phone: draft.phone.trim() || undefined,
      });

      if (result.queued) {
        toast.success(`${who} queued · ${DAY_LABEL[day]}. Will save when you're back online.`);
      } else {
        toast.success(`${who} checked ${kind === 'in' ? 'in' : 'out'} · ${DAY_LABEL[day]}`);
        if (result.data?.warning?.startsWith('phone_already_used_by:')) {
          // Shared numbers are normal for couples and families, so this informs
          // rather than blocks.
          toast.warning(`That number is also on ${result.data.warning.split(':')[1]}'s badge.`);
        }
      }

      // Kept while offline: the seat still reads as anonymous until the queue
      // drains, so a second day queued now would be refused on flush — hours
      // later, with nobody left to ask for the name again.
      if (!result.queued) {
        setDrafts((prev) => ({ ...prev, [attendee.attendee_id]: EMPTY_DRAFT }));
        await refresh(query);
      }
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
      const result = await submit<unknown>('/api/admin/check-in/undo', {
        event_id: eventId,
        client_event_id: newClientEventId(),
      });
      toast.success(
        result.queued
          ? `Undo queued · ${attendee.name}, ${DAY_LABEL[day]}`
          : `Undone · ${attendee.name}, ${DAY_LABEL[day]}`,
      );
      if (!result.queued) await refresh(query);
    } catch (error) {
      showApiError(error);
    } finally {
      setBusy(null);
    }
  }

  function pendingFor(registration: CheckInRegistration, day: CheckInDay): CheckInAttendee[] {
    return registration.attendees.filter((a) => a.valid_days.includes(day) && a.state[day] !== 'in');
  }

  async function checkInAll(registration: CheckInRegistration, day: CheckInDay) {
    const pending = pendingFor(registration, day);
    if (pending.length === 0) return;

    // Whole-group, not partial: quietly checking in three of four and reporting
    // "3 checked in" is how somebody ends up inside with no record.
    const unnamed = pending.filter((a) => gapFor(a) !== null);
    if (unnamed.length > 0) {
      toast.error(
        `${unnamed.map((a) => a.name).join(', ')} still ${unnamed.length === 1 ? 'needs' : 'need'} a name and number.`,
      );
      return;
    }

    setBusy(`${registration.registration_id}:${day}`);
    try {
      const result = await submit<{ results?: { attendee_id: string; ok: boolean; error?: string }[] }>('/api/admin/check-in/bulk', {
        // The bulk body carries its own id so the queue can key on it, while
        // each entry keeps the id that deduplicates that individual check-in.
        client_event_id: newClientEventId(),
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
      });
      if (result.queued) {
        toast.success(`${pending.length} queued · ${DAY_LABEL[day]}`);
      } else {
        // The batch reports per seat, so a refusal buried in it must be read out
        // rather than counted as a success.
        const failed = (result.data?.results ?? []).filter((r) => !r.ok);
        const done = pending.length - failed.length;
        if (done > 0) toast.success(`${done} checked in · ${DAY_LABEL[day]}`);
        for (const f of failed) {
          const who = pending.find((a) => a.attendee_id === f.attendee_id)?.name ?? 'A seat';
          toast.error(`${who} not checked in: ${f.error ?? 'refused'}`);
        }
        await refresh(query);
      }
    } catch (error) {
      showApiError(error);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-5 p-4 md:p-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-bold">Check in</h1>
        <p className="text-sm text-muted-foreground">
          Search the purchaser’s phone number — it’s the one thing every attendee can
          give you. Anyone who didn’t buy their own ticket needs their name and number
          taken here before they can be checked in; after that they can be found by
          either.
        </p>
      </header>

      {totals && (
        <section aria-label="Attendance so far" className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {(['day1', 'day2'] as CheckInDay[]).map((day) => (
            <DayTally
              key={day}
              day={day}
              totals={totals.days[day]}
              isToday={totals.today === day}
              // Queued arrivals have not reached the database, so the tally is
              // behind by exactly that many until the queue drains. Saying so
              // is cheaper than a figure the desk quietly learns to distrust.
              pending={queued}
            />
          ))}
        </section>
      )}

      {(!online || queued > 0) && (
        <p className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm">
          {!online && 'You’re offline — keep checking people in. '}
          {queued > 0
            ? `${queued} check-in${queued === 1 ? '' : 's'} waiting to save${online ? ', sending now…' : '.'}`
            : 'Anything you do is saved as soon as the connection returns.'}
        </p>
      )}

      <form onSubmit={onSubmit} className="flex gap-2">
        <Input
          ref={searchRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Purchaser’s phone number"
          inputMode="text"
          autoComplete="off"
          aria-label="Search by purchaser phone, attendee phone, or name"
        />
        <Button type="submit" disabled={searching}>Search</Button>
        <Button type="button" variant="outline" onClick={() => void exportRoster()} disabled={exporting}>
          {exporting ? 'Preparing…' : 'Roster'}
        </Button>
      </form>

      {searching && <Loading><span>Searching…</span></Loading>}

      {results?.length === 0 && (
        <p className="text-sm text-muted-foreground">
          Nobody matched. A guest is only findable by their own name or number after
          you’ve taken it here — until then, ask who booked and search that number.
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
                  {registration.days.map((day) => {
                    const unnamed = pendingFor(registration, day).filter((a) => gapFor(a) !== null);
                    return (
                      <Button
                        key={day}
                        size="sm"
                        variant="secondary"
                        disabled={busy !== null || unnamed.length > 0}
                        title={unnamed.length > 0
                          ? `${unnamed.map((a) => a.name).join(', ')} still need a name and number`
                          : undefined}
                        onClick={() => void checkInAll(registration, day)}
                      >
                        Check in all · {DAY_LABEL[day]}
                      </Button>
                    );
                  })}
                </div>
              )}
            </div>

            <ul className="space-y-4">
              {registration.attendees.map((attendee) => {
                const gap = gapFor(attendee);
                const required = !attendee.is_purchaser;
                return (
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

                  {/* Required for a guest seat, offered for the buyer's own. */}
                  {(!attendee.has_name || !attendee.has_phone) && (
                    <div className="space-y-1">
                      <div className="flex flex-wrap gap-2">
                        {!attendee.has_name && (
                          <Input
                            className="max-w-[12rem]"
                            value={draftFor(attendee.attendee_id).name}
                            onChange={(e) => setDraft(attendee.attendee_id, { name: e.target.value })}
                            placeholder={required ? 'Name (required)' : 'Name (optional)'}
                            required={required}
                            aria-required={required}
                            aria-label={`Name for seat ${attendee.seat_index}`}
                          />
                        )}
                        {!attendee.has_phone && (
                          <Input
                            className="max-w-[12rem]"
                            value={draftFor(attendee.attendee_id).phone}
                            onChange={(e) => setDraft(attendee.attendee_id, { phone: e.target.value })}
                            placeholder={required ? 'Phone (required)' : 'Phone (optional)'}
                            required={required}
                            aria-required={required}
                            inputMode="numeric"
                            aria-label={`Phone for seat ${attendee.seat_index}`}
                          />
                        )}
                      </div>
                      {/* Said on the card, not only as a tooltip — the desk is on
                          a tablet, where nothing hovers. */}
                      {gap && (
                        <p className="text-xs text-amber-600 dark:text-amber-500">
                          {gap} before this guest can be checked in.
                        </p>
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
                      // Checking out is never gated: refusing a departure gives
                      // you a wrong occupancy count, not a name.
                      const blocked = state !== 'in' && gap !== null;
                      return (
                        <span key={day} className="flex items-center gap-1">
                          <Button
                            size="sm"
                            variant={state === 'in' ? 'secondary' : 'default'}
                            disabled={busy === key || blocked}
                            title={blocked ? `${gap} first` : undefined}
                            onClick={() => void act(attendee, day, state === 'in' ? 'out' : 'in')}
                          >
                            {state === 'in' ? `Check out · ${DAY_LABEL[day]}` : `Check in · ${DAY_LABEL[day]}`}
                          </Button>
                          {attendee.last_event[day] && (
                            <Button
                              size="sm"
                              variant="ghost"
                              disabled={busy === key}
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

                  {attendee.can_pair && (
                    <div className="space-y-2">
                      {!codes[attendee.attendee_id] && (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={busy === `${attendee.attendee_id}:code`}
                          onClick={() => void issueCode(attendee)}
                        >
                          Get app code
                        </Button>
                      )}
                      {codes[attendee.attendee_id] && (
                        <PairingCodePanel
                          code={codes[attendee.attendee_id]}
                          busy={busy === `${attendee.attendee_id}:code`}
                          onReissue={() => void issueCode(attendee)}
                        />
                      )}
                    </div>
                  )}
                </li>
                );
              })}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}

/**
 * One day's door figure: tickets sold against people through it.
 *
 * "Arrived" leads, because that is the question being asked — how much of the
 * day has walked in. "Inside now" is a different number and appears only once
 * somebody has checked out, so the desk is not made to read two figures that
 * say the same thing all morning.
 */
export function DayTally({ day, totals, isToday, pending }: {
  day: CheckInDay;
  totals: CheckInDayTotals;
  isToday: boolean;
  pending: number;
}) {
  const { expected, arrived, inside } = totals;
  const pct = expected > 0 ? Math.min(100, Math.round((arrived / expected) * 100)) : 0;
  const steppedOut = arrived - inside;
  const toCome = Math.max(0, expected - arrived);

  return (
    <div className={`rounded-lg border p-4 ${isToday ? 'border-primary' : ''}`}>
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-sm font-medium">
          {DAY_NAME[day]}
          {isToday && <span className="ml-2 text-xs font-normal text-primary">today</span>}
        </span>
        <span className="text-sm text-muted-foreground tabular-nums">{expected > 0 ? `${pct}%` : '—'}</span>
      </div>

      <p className="mt-1 text-2xl font-bold tabular-nums">
        {arrived}
        <span className="text-base font-normal text-muted-foreground">
          {' '}/ {expected} checked in
        </span>
      </p>

      <div className="mt-2 h-2 w-full rounded bg-muted" aria-hidden="true">
        <div className="h-2 rounded bg-primary" style={{ width: `${pct}%` }} />
      </div>

      <p className="mt-1 text-xs text-muted-foreground">
        {expected === 0
          ? 'No tickets sold for this day yet.'
          : `${toCome} still to arrive`}
        {steppedOut > 0 && ` · ${inside} inside now, ${steppedOut} stepped out`}
        {pending > 0 && ` · ${pending} not counted until your queue saves`}
      </p>
    </div>
  );
}
