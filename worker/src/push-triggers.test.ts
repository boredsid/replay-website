import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('./push-send', () => ({ notifyAttendees: vi.fn() }));

import { notifyAnnouncement, sendSessionReminders, runsShortEnoughToStart, REMINDER_LEAD_MINUTES } from './push-triggers';
import { notifyAttendees } from './push-send';
import type { Env } from './index';

const notify = notifyAttendees as unknown as ReturnType<typeof vi.fn>;
const ENV = {} as unknown as Env;
const EDITION = { id: 'ed-1', start_date: '2026-09-12', end_date: '2026-09-13' };

beforeEach(() => {
  notify.mockReset();
  notify.mockResolvedValue({ sent: 1, pruned: 0, failed: 0 });
});

function announcement(severity: string) {
  return { id: 'n1', title: 'Room change', body: 'Meet in Room B', severity, audience: 'all' };
}

const attendeeClient = {
  from: () => ({ select: () => ({ eq: async () => ({ data: [{ id: 'a1' }, { id: 'a2' }], error: null }) }) }),
} as never;

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

  it('stays quiet about a drop-in table that happens to open at this hour', async () => {
    // Board Games Open Tables runs 09:00-21:00 with is_all_day = false, because
    // the schedule wants to print its hours. "Starts soon" is wrong for it.
    const dropIn = { ...SESSION_AT_2PM, title: 'Board Games Open Tables', end_time: '02:00:00' };
    const result = await sendSessionReminders(
      ENV, reminderClient({ sessions: [{ ...dropIn, start_time: '14:00:00', end_time: '23:00:00' }], signups: BOOKED }), DURING_DAY1,
    );
    expect(result.sessions).toBe(0);
    expect(notify).not.toHaveBeenCalled();
  });

  it('still reminds about the longest real slot in the programme', async () => {
    // Every RPG block is four hours. The cut has to fall above them, not on them.
    const result = await sendSessionReminders(
      ENV, reminderClient({ sessions: [{ ...SESSION_AT_2PM, end_time: '18:00:00' }], signups: BOOKED }), DURING_DAY1,
    );
    expect(result.sessions).toBe(1);
  });

  it('mentions the lead time it actually uses', async () => {
    await sendSessionReminders(ENV, reminderClient({ sessions: [SESSION_AT_2PM], signups: BOOKED }), DURING_DAY1);
    expect(notify.mock.calls[0][4].body).toContain(String(REMINDER_LEAD_MINUTES));
  });
});

describe('runsShortEnoughToStart', () => {
  it('accepts a session with no end time at all', () => {
    // Nothing to judge it by, and a start is reason enough until told otherwise.
    expect(runsShortEnoughToStart('14:00:00', null)).toBe(true);
  });

  it('accepts the four-hour block the RPG slots use', () => {
    expect(runsShortEnoughToStart('14:00:00', '18:00:00')).toBe(true);
  });

  it('rejects the five-hour painting station', () => {
    expect(runsShortEnoughToStart('14:00:00', '19:00:00')).toBe(false);
  });

  it('rejects a twelve-hour open table', () => {
    expect(runsShortEnoughToStart('09:00:00', '21:00:00')).toBe(false);
  });
});
