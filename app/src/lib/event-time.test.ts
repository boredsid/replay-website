import { describe, expect, it } from 'vitest';
import { formatClock, formatDate, getEventStatus, nowAndNext } from './event-time';
import type { EditionData, ScheduleItem } from '../types';

const edition: EditionData = {
  slug: 'replay-3', name: 'REPLAY', start_date: '2026-09-12', end_date: '2026-09-13',
  daily_start_time: '10:00:00', daily_end_time: '19:00:00', venue: 'TBD',
};

function item(overrides: Partial<ScheduleItem>): ScheduleItem {
  return {
    id: 'item', day: '2026-09-12', start_time: '10:00:00', end_time: '11:00:00',
    title: 'Session', description: null, location: null, kind: 'workshop', section: 'programme',
    is_all_day: false, host_name: null, signup_mode: 'none', signup_url: null,
    public_status: 'published', display_order: 0, ...overrides,
  };
}

describe('event time', () => {
  it('formats event clock values without depending on the device timezone', () => {
    expect(formatClock('10:00:00')).toBe('10:00 AM');
    expect(formatClock('19:30:00')).toBe('7:30 PM');
    expect(formatClock(null)).toBe('All day');
  });

  it('formats date-only event values without shifting to the previous device-local day', () => {
    expect(formatDate('2026-09-12')).toBe('Sat, 12 Sept');
  });

  it('describes before, during, between, and after the two event days', () => {
    expect(getEventStatus(edition, new Date('2026-09-11T10:00:00Z')).state).toBe('upcoming');
    expect(getEventStatus(edition, new Date('2026-09-12T03:00:00Z')).state).toBe('opens-today');
    expect(getEventStatus(edition, new Date('2026-09-12T06:00:00Z')).state).toBe('open');
    expect(getEventStatus(edition, new Date('2026-09-12T16:00:00Z')).state).toBe('between-days');
    expect(getEventStatus(edition, new Date('2026-09-13T15:00:00Z')).state).toBe('ended');
  });

  it('finds simultaneous happening and next sessions while excluding cancellations', () => {
    const result = nowAndNext([
      item({ id: 'all-day', is_all_day: true, start_time: null, end_time: null }),
      item({ id: 'happening' }),
      item({ id: 'next-a', start_time: '11:30:00', end_time: '12:00:00' }),
      item({ id: 'next-b', start_time: '11:30:00', end_time: '13:00:00' }),
      item({ id: 'cancelled', start_time: '11:15:00', end_time: '11:30:00', public_status: 'cancelled' }),
    ], edition, new Date('2026-09-12T05:15:00Z'));

    expect(result.happening.map((entry) => entry.id)).toEqual(['all-day', 'happening']);
    expect(result.next.map((entry) => entry.id)).toEqual(['next-a', 'next-b']);
  });
});
