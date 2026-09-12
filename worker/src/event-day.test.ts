import { describe, it, expect } from 'vitest';
import { bookableDays, dateForDay, editionDayForToday, pairingGateDay } from './event-day';
import type { CheckInEvent } from './admin/check-in-state';

const EDITION = { start_date: '2026-09-12', end_date: '2026-09-13' };

function arrival(day: 'day1' | 'day2', id = day): CheckInEvent {
  return { id, day, kind: 'in', voids_event_id: null, occurred_at: '2026-09-12T04:00:00Z' } as CheckInEvent;
}

// Midday IST on each day, so the date the rule reads is unambiguous.
const DAY_1 = new Date('2026-09-12T06:30:00Z');
const DAY_2 = new Date('2026-09-13T06:30:00Z');
const BEFORE = new Date('2026-09-01T06:30:00Z');

describe('editionDayForToday', () => {
  it('names the day in the event timezone, not the machine’s', () => {
    // 23:30 UTC on the 11th is already 05:00 on the 12th in Bangalore.
    expect(editionDayForToday(EDITION, new Date('2026-09-11T23:30:00Z'))).toBe('day1');
  });

  it('is null outside the event', () => {
    expect(editionDayForToday(EDITION, BEFORE)).toBeNull();
  });
});

describe('dateForDay', () => {
  it('maps each day onto the edition’s own dates', () => {
    expect(dateForDay(EDITION, 'day1')).toBe(EDITION.start_date);
    expect(dateForDay(EDITION, 'day2')).toBe(EDITION.end_date);
  });
});

describe('bookableDays', () => {
  it('offers only today, even to a ticket covering both days', () => {
    // The whole point: a two-day ticket does not let somebody hold Sunday seats
    // from their sofa on Saturday.
    expect(bookableDays(EDITION, ['day1', 'day2'], [arrival('day1')], DAY_1)).toEqual(['day1']);
  });

  it('offers nothing to somebody who has not arrived today', () => {
    expect(bookableDays(EDITION, ['day1', 'day2'], [arrival('day1')], DAY_2)).toEqual([]);
  });

  it('opens day 2 the moment the desk sees them on day 2', () => {
    expect(bookableDays(EDITION, ['day1', 'day2'], [arrival('day1'), arrival('day2')], DAY_2)).toEqual(['day2']);
  });

  it('relaxes outside the event so the flow can be rehearsed', () => {
    expect(bookableDays(EDITION, ['day1', 'day2'], [arrival('day1'), arrival('day2')], BEFORE))
      .toEqual(['day1', 'day2']);
  });

  it('never offers a day the ticket does not cover', () => {
    expect(bookableDays(EDITION, ['day1'], [arrival('day1'), arrival('day2')], BEFORE)).toEqual(['day1']);
  });
});

describe('pairingGateDay', () => {
  it('is the first bookable day, so the two rules cannot disagree', () => {
    expect(pairingGateDay(EDITION, ['day1', 'day2'], [arrival('day1')], DAY_1)).toBe('day1');
    expect(pairingGateDay(EDITION, ['day1', 'day2'], [arrival('day1')], DAY_2)).toBeNull();
    expect(pairingGateDay(EDITION, ['day1', 'day2'], [arrival('day2')], BEFORE)).toBe('day2');
  });
});
