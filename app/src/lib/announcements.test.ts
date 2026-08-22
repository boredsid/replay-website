import { describe, expect, it } from 'vitest';
import { currentEventDay, visibleAnnouncements } from './announcements';
import type { AnnouncementData, EditionData } from '../types';

const edition: EditionData = {
  slug: 'replay-3',
  name: 'REPLAY',
  start_date: '2026-09-12',
  end_date: '2026-09-13',
  daily_start_time: '09:00:00',
  daily_end_time: '20:00:00',
  venue: 'Indiqube Symphony, MG Road',
};

function notice(id: string, audience: AnnouncementData['audience']): AnnouncementData {
  return {
    id,
    title: `Notice ${id}`,
    body: 'Body',
    severity: 'info',
    audience,
    starts_at: '2026-09-12T04:00:00.000Z',
    ends_at: null,
    updated_at: '2026-09-12T04:00:00.000Z',
  };
}

const all = notice('a', 'all');
const day1 = notice('b', 'day1');
const day2 = notice('c', 'day2');

// 05:30 UTC is 11:00 IST — safely inside the IST day, not near a rollover.
const onDay1 = new Date('2026-09-12T05:30:00.000Z');
const onDay2 = new Date('2026-09-13T05:30:00.000Z');
const beforeEvent = new Date('2026-08-21T05:30:00.000Z');

describe('currentEventDay', () => {
  it('identifies each event day in IST', () => {
    expect(currentEventDay(edition, onDay1)).toBe('day1');
    expect(currentEventDay(edition, onDay2)).toBe('day2');
  });

  it('returns null outside the event and without an edition', () => {
    expect(currentEventDay(edition, beforeEvent)).toBeNull();
    expect(currentEventDay(null, onDay1)).toBeNull();
  });

  it('uses IST rather than UTC at the day boundary', () => {
    // 20:00 UTC on the 11th is already 01:30 IST on the 12th — day one.
    expect(currentEventDay(edition, new Date('2026-09-11T20:00:00.000Z'))).toBe('day1');
  });

  it('treats a single-day edition as day one', () => {
    const oneDay = { ...edition, end_date: edition.start_date };
    expect(currentEventDay(oneDay, onDay1)).toBe('day1');
  });
});

describe('visibleAnnouncements', () => {
  it('hides the other day once we know which day it is', () => {
    expect(visibleAnnouncements([all, day1, day2], edition, onDay1)).toEqual([all, day1]);
    expect(visibleAnnouncements([all, day1, day2], edition, onDay2)).toEqual([all, day2]);
  });

  it('shows everything when there is no day context', () => {
    expect(visibleAnnouncements([all, day1, day2], edition, beforeEvent)).toEqual([all, day1, day2]);
    expect(visibleAnnouncements([all, day1, day2], null, onDay1)).toEqual([all, day1, day2]);
  });

  it('never drops an all-audience notice', () => {
    expect(visibleAnnouncements([day2, all], edition, onDay1)).toEqual([all]);
  });
});
