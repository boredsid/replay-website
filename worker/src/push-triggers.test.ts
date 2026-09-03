import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('./push-send', () => ({ notifyAttendees: vi.fn() }));

import { notifyAnnouncement, sendDueAnnouncements, sendSessionReminders, REMINDER_LEAD_MINUTES } from './push-triggers';
import { notifyAttendees } from './push-send';
import type { Env } from './index';

const notify = notifyAttendees as unknown as ReturnType<typeof vi.fn>;
const ENV = {} as unknown as Env;
const EDITION = { id: 'ed-1', start_date: '2026-09-12', end_date: '2026-09-13' };

beforeEach(() => {
  notify.mockReset();
  notify.mockResolvedValue({ sent: 1, pruned: 0, failed: 0 });
});

function announcement(severity: string, audience = 'all') {
  return { id: 'n1', title: 'Room change', body: 'Meet in Room B', severity, audience };
}

const attendeeClient = {
  from: () => ({ select: () => ({ eq: async () => ({ data: [{ id: 'a1' }, { id: 'a2' }], error: null }) }) }),
} as never;

/** Seats whose tickets cover the given days. */
function audienceClient(rows: Array<{ id: string; days: string[] | null }>, asArray = false) {
  const data = rows.map((row) => ({
    id: row.id,
    registrations: asArray ? [{ days: row.days }] : { days: row.days },
  }));
  return {
    from: () => ({ select: () => ({ eq: async () => ({ data, error: null }) }) }),
  } as never;
}

const MIXED = [
  { id: 'both', days: ['day1', 'day2'] },
  { id: 'only-1', days: ['day1'] },
  { id: 'only-2', days: ['day2'] },
];

describe('notifyAnnouncement', () => {
  it.each(['urgent', 'incident'])('notifies for a %s notice', async (severity) => {
    await notifyAnnouncement(ENV, attendeeClient, announcement(severity), EDITION.id);
    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify.mock.calls[0][3]).toBe('announcements');
  });

  it('stays silent for routine news', async () => {
    // A channel that buzzes for ordinary updates gets switched off, and is then
    // not there for the notice that matters.
    expect(await notifyAnnouncement(ENV, attendeeClient, announcement('info'), EDITION.id)).toBeNull();
    expect(notify).not.toHaveBeenCalled();
  });

  it('marks an incident as important in the title', async () => {
    await notifyAnnouncement(ENV, attendeeClient, announcement('incident'), EDITION.id);
    expect(notify.mock.calls[0][4].title).toBe('Important: Room change');
  });

  it('tags per announcement so an edit replaces its earlier self', async () => {
    await notifyAnnouncement(ENV, attendeeClient, announcement('urgent'), EDITION.id);
    expect(notify.mock.calls[0][4].tag).toBe('announcement-n1');
  });

  it('notifies every attendee of the edition', async () => {
    await notifyAnnouncement(ENV, attendeeClient, announcement('urgent'), EDITION.id);
    expect(notify.mock.calls[0][2]).toEqual(['a1', 'a2']);
  });

  it.each([
    ['day1', ['both', 'only-1']],
    ['day2', ['both', 'only-2']],
  ])('sends a %s notice only to tickets covering that day', async (audience, expected) => {
    // A day-1 notice reaching a day-2 ticket holder is noise they cannot act
    // on, spent from the one channel that has to be trusted in an incident.
    await notifyAnnouncement(ENV, audienceClient(MIXED), announcement('urgent', audience), EDITION.id);
    expect(notify.mock.calls[0][2]).toEqual(expected);
  });

  it('still reaches everyone when the audience is all', async () => {
    await notifyAnnouncement(ENV, audienceClient(MIXED), announcement('urgent', 'all'), EDITION.id);
    expect(notify.mock.calls[0][2]).toEqual(['both', 'only-1', 'only-2']);
  });

  it('filters correctly when the embed arrives as an array', async () => {
    // PostgREST returns a many-to-one embed as an object, but falls back to an
    // array if it cannot resolve the relationship. Either shape must filter.
    await notifyAnnouncement(ENV, audienceClient(MIXED, true), announcement('urgent', 'day2'), EDITION.id);
    expect(notify.mock.calls[0][2]).toEqual(['both', 'only-2']);
  });

  it('sends to nobody rather than everybody when a ticket has no days', async () => {
    // The failure that matters is the loud one: a seat with no ticket behind it
    // must not fall through into a day-specific notice.
    await notifyAnnouncement(
      ENV,
      audienceClient([{ id: 'orphan', days: null }]),
      announcement('urgent', 'day1'),
      EDITION.id,
    );
    expect(notify.mock.calls[0][2]).toEqual([]);
  });
});

interface DispatchFixture {
  due?: Array<Record<string, unknown>>;
  onUpdate?: (id: string, patch: Record<string, unknown>) => void;
  /** Records the `starts_at <= ?` bound the query asked for. */
  onDueFilter?: (column: string, value: unknown) => void;
}

function dispatchClient(f: DispatchFixture = {}) {
  return {
    from: (table: string) => {
      if (table === 'attendees') {
        return { select: () => ({ eq: async () => ({ data: [{ id: 'a1' }, { id: 'a2' }], error: null }) }) };
      }
      return {
        select: () => ({
          eq: () => ({
            is: () => ({
              lte: async (column: string, value: unknown) => {
                f.onDueFilter?.(column, value);
                return { data: f.due ?? [], error: null };
              },
            }),
          }),
        }),
        update: (patch: Record<string, unknown>) => ({
          eq: async (_column: string, id: string) => { f.onUpdate?.(id, patch); return { error: null }; },
        }),
      };
    },
  } as never;
}

function due(over: Record<string, unknown> = {}) {
  return {
    id: 'n1', edition_id: 'ed-1', title: 'Room change', body: 'Room B',
    severity: 'urgent', audience: 'all', ends_at: null, ...over,
  };
}

describe('sendDueAnnouncements', () => {
  const NOW = new Date('2026-09-12T06:00:00.000Z');

  it('sends a notice that has come due and records what it reached', async () => {
    const stamps: Array<[string, Record<string, unknown>]> = [];
    const result = await sendDueAnnouncements(ENV, dispatchClient({
      due: [due()],
      onUpdate: (id, patch) => stamps.push([id, patch]),
    }), NOW);

    expect(notify).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ sent: 1, expired: 0 });
    // The stamp is what stops the next tick sending it again.
    expect(stamps[0][0]).toBe('n1');
    expect(stamps[0][1]).toMatchObject({ notified_sent: 1, notified_failed: 0 });
    expect(stamps[0][1].notified_at).toEqual(expect.any(String));
  });

  it('only asks for notices whose start time has passed', async () => {
    const filters: Array<[string, unknown]> = [];
    await sendDueAnnouncements(ENV, dispatchClient({ onDueFilter: (c, v) => filters.push([c, v]) }), NOW);
    expect(filters).toEqual([['starts_at', NOW.toISOString()]]);
  });

  it('stamps without sending a notice whose window closed before the tick', async () => {
    // Buzzing a phone about something already over is worse than silence, and
    // leaving it unstamped would mean trying again on every tick, forever.
    const stamps: Array<[string, Record<string, unknown>]> = [];
    const result = await sendDueAnnouncements(ENV, dispatchClient({
      due: [due({ ends_at: '2026-09-12T05:59:00.000Z' })],
      onUpdate: (id, patch) => stamps.push([id, patch]),
    }), NOW);

    expect(notify).not.toHaveBeenCalled();
    expect(result).toEqual({ sent: 0, expired: 1 });
    expect(stamps[0][1]).toMatchObject({ notified_sent: 0, notified_failed: 0 });
  });

  it('stamps an info notice it never pushes, so the cron lets go of it', async () => {
    notify.mockResolvedValue({ sent: 0, pruned: 0, failed: 0 });
    const stamps: Array<[string, Record<string, unknown>]> = [];
    await sendDueAnnouncements(ENV, dispatchClient({
      due: [due({ severity: 'info' })],
      onUpdate: (id, patch) => stamps.push([id, patch]),
    }), NOW);

    expect(notify).not.toHaveBeenCalled();
    expect(stamps).toHaveLength(1);
    expect(stamps[0][1]).toMatchObject({ notified_sent: 0 });
  });
});

interface ReminderFixture {
  sessions?: Array<Record<string, unknown>>;
  signups?: Array<Record<string, unknown>>;
  stars?: Array<Record<string, unknown>>;
  onStamp?: (ids: string[]) => void;
  onStarStamp?: (ids: string[]) => void;
  /** Records the filters put on the schedule_items query. */
  onSessionFilter?: (column: string, value: unknown) => void;
  edition?: Record<string, unknown> | null;
}

function reminderClient(f: ReminderFixture = {}) {
  const sessions = f.sessions ?? [];
  return {
    from: (table: string) => {
      if (table === 'editions') return {
        select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: f.edition === undefined ? EDITION : f.edition, error: null }) }) }),
      };
      if (table === 'schedule_items') {
        const eq = (column: string, value: unknown) => {
          f.onSessionFilter?.(column, value);
          return { eq, not: async () => ({ data: sessions, error: null }) };
        };
        return { select: () => ({ eq }) };
      }
      if (table === 'session_signups') return {
        select: () => ({ eq: () => ({ eq: () => ({ is: async () => ({ data: f.signups ?? [], error: null }) }) }) }),
        update: () => ({ in: async (_col: string, ids: string[]) => { f.onStamp?.(ids); return { error: null }; } }),
      };
      if (table === 'saved_items') return {
        select: () => ({ eq: () => ({ is: async () => ({ data: f.stars ?? [], error: null }) }) }),
        update: () => ({ in: async (_col: string, ids: string[]) => { f.onStarStamp?.(ids); return { error: null }; } }),
      };
      throw new Error(`unexpected table ${table}`);
    },
  } as never;
}

// 13:45 IST on day 1 — a 14:00 session is exactly the lead time away.
const DURING_DAY1 = new Date('2026-09-12T08:15:00Z');
const SESSION_AT_2PM = { id: 's1', title: 'Werewolf', start_time: '14:00:00', end_time: '16:00:00', location: 'Sandbox' };
const BOOKED = [{ id: 'su1', attendee_id: 'a1' }];
const STARRED = [{ id: 'sv1', attendee_id: 'a2' }];

describe('sendSessionReminders', () => {
  it('reminds the people booked into a session about to start', async () => {
    const result = await sendSessionReminders(
      ENV, reminderClient({ sessions: [SESSION_AT_2PM], signups: BOOKED }), DURING_DAY1,
    );

    expect(result).toMatchObject({ sessions: 1 });
    expect(notify.mock.calls[0][3]).toBe('reminders');
    expect(notify.mock.calls[0][4].title).toBe('Werewolf starts soon');
    expect(notify.mock.calls[0][4].body).toContain('Sandbox');
  });

  it('stamps the sign-ups it reminded, which is what makes a retry safe', async () => {
    let stamped: string[] = [];
    await sendSessionReminders(
      ENV, reminderClient({ sessions: [SESSION_AT_2PM], signups: BOOKED, onStamp: (ids) => { stamped = ids; } }), DURING_DAY1,
    );
    // Cron delivery is at-least-once; without this a retry reminds everybody twice.
    expect(stamped).toEqual(['su1']);
  });

  it('ignores a session that is still hours away', async () => {
    const result = await sendSessionReminders(
      ENV, reminderClient({ sessions: [{ ...SESSION_AT_2PM, start_time: '18:00:00', end_time: '20:00:00' }], signups: BOOKED }), DURING_DAY1,
    );
    expect(result.sessions).toBe(0);
    expect(notify).not.toHaveBeenCalled();
  });

  it('ignores a session that already started', async () => {
    const result = await sendSessionReminders(
      ENV, reminderClient({ sessions: [{ ...SESSION_AT_2PM, start_time: '13:00:00', end_time: '15:00:00' }], signups: BOOKED }), DURING_DAY1,
    );
    expect(result.sessions).toBe(0);
  });

  it('sends nothing when nobody booked or starred it', async () => {
    await sendSessionReminders(ENV, reminderClient({ sessions: [SESSION_AT_2PM], signups: [] }), DURING_DAY1);
    expect(notify).not.toHaveBeenCalled();
  });

  it('reminds someone who only starred it', async () => {
    // A star is the other way of saying "I mean to be there", and for most of
    // the programme -- which takes no bookings at all -- it is the only way.
    const result = await sendSessionReminders(
      ENV, reminderClient({ sessions: [SESSION_AT_2PM], signups: [], stars: STARRED }), DURING_DAY1,
    );
    expect(result.sessions).toBe(1);
    expect(notify.mock.calls[0][2]).toEqual(['a2']);
  });

  it('reminds a booked and a starred attendee together, in one send', async () => {
    await sendSessionReminders(
      ENV, reminderClient({ sessions: [SESSION_AT_2PM], signups: BOOKED, stars: STARRED }), DURING_DAY1,
    );
    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify.mock.calls[0][2]).toEqual(['a1', 'a2']);
  });

  it('notifies someone who both booked and starred exactly once', async () => {
    await sendSessionReminders(
      ENV,
      reminderClient({ sessions: [SESSION_AT_2PM], signups: BOOKED, stars: [{ id: 'sv1', attendee_id: 'a1' }] }),
      DURING_DAY1,
    );
    // Two records of the same intention are still one person and one nudge.
    expect(notify.mock.calls[0][2]).toEqual(['a1']);
  });

  it('stamps both tables, or the next tick reminds the half it missed', async () => {
    let signupIds: string[] = [];
    let starIds: string[] = [];
    await sendSessionReminders(
      ENV,
      reminderClient({
        sessions: [SESSION_AT_2PM],
        signups: BOOKED,
        stars: STARRED,
        onStamp: (ids) => { signupIds = ids; },
        onStarStamp: (ids) => { starIds = ids; },
      }),
      DURING_DAY1,
    );
    expect(signupIds).toEqual(['su1']);
    expect(starIds).toEqual(['sv1']);
  });

  it('does nothing at all outside the event days', async () => {
    const result = await sendSessionReminders(
      ENV, reminderClient({ sessions: [SESSION_AT_2PM], signups: BOOKED }), new Date('2026-09-01T08:15:00Z'),
    );
    // The cron runs year-round; it must be free on every other day.
    expect(result).toEqual({ reminded: 0, sessions: 0 });
    expect(notify).not.toHaveBeenCalled();
  });

  it('does nothing when no edition is current', async () => {
    const result = await sendSessionReminders(ENV, reminderClient({ edition: null }), DURING_DAY1);
    expect(result).toEqual({ reminded: 0, sessions: 0 });
  });

  it('uses IST for the day, not UTC', async () => {
    // 20:00 UTC on the 11th is already the 12th in Bangalore, and a 01:45 IST
    // session would be reminded then. Judged by UTC this would be the wrong day.
    const justAfterMidnightIST = new Date('2026-09-11T20:15:00Z');
    const result = await sendSessionReminders(
      ENV,
      reminderClient({ sessions: [{ ...SESSION_AT_2PM, start_time: '02:00:00', end_time: '04:00:00' }], signups: BOOKED }),
      justAfterMidnightIST,
    );
    expect(result.sessions).toBe(1);
  });

  it('never reminds about an all-day activity', async () => {
    // "Board Games Open Tables, in about fifteen minutes" is nonsense: it has
    // been open all day. The filter belongs in the query, so assert it is there.
    const filters: Array<[string, unknown]> = [];
    await sendSessionReminders(
      ENV,
      reminderClient({
        sessions: [SESSION_AT_2PM],
        signups: BOOKED,
        onSessionFilter: (column, value) => filters.push([column, value]),
      }),
      DURING_DAY1,
    );
    expect(filters).toContainEqual(['is_all_day', false]);
  });

  it('reminds about a long session, since only the flag decides', async () => {
    // A five-hour slot is still a slot with a start. Whether something is a
    // drop-in is is_all_day's job, set from the admin -- guessing from the
    // duration here would quietly override whoever set it.
    const result = await sendSessionReminders(
      ENV, reminderClient({ sessions: [{ ...SESSION_AT_2PM, end_time: '19:00:00' }], signups: BOOKED }), DURING_DAY1,
    );
    expect(result.sessions).toBe(1);
  });

  it('mentions the lead time it actually uses', async () => {
    await sendSessionReminders(ENV, reminderClient({ sessions: [SESSION_AT_2PM], signups: BOOKED }), DURING_DAY1);
    expect(notify.mock.calls[0][4].body).toContain(String(REMINDER_LEAD_MINUTES));
  });
});
