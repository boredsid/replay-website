import { describe, it, expect } from 'vitest';
import { passLabel, dayName, dayStatus, type Pass, type PassDay } from './pass';

function day(overrides: Partial<PassDay> = {}): PassDay {
  return { day: 'day1', date: '2026-09-12', covered: true, arrived: false, present: null, ...overrides };
}

function pass(days: PassDay[]): Pass {
  return { display_name: 'Siddhant Narula', seat_index: 1, pass_type: 'campaign', days };
}

describe('dayName', () => {
  it('names the day in the event\'s own timezone', () => {
    // Built from a bare date, which parses as UTC midnight and would land on
    // the 11th for anyone reading it west of Bangalore.
    expect(dayName(day({ date: '2026-09-12' }))).toBe('Sat, 12 Sept');
    expect(dayName(day({ day: 'day2', date: '2026-09-13' }))).toBe('Sun, 13 Sept');
  });

  it('falls back to a day number rather than showing Invalid Date', () => {
    expect(dayName(day({ date: 'not-a-date' }))).toBe('Day 1');
  });
});

describe('passLabel', () => {
  it('calls a two-day ticket both days', () => {
    expect(passLabel(pass([day(), day({ day: 'day2', date: '2026-09-13' })]))).toBe('Both days');
  });

  it('names the single day a one-day ticket covers', () => {
    expect(passLabel(pass([day(), day({ day: 'day2', date: '2026-09-13', covered: false })])))
      .toBe('Sat, 12 Sept only');
  });

  it('says nothing specific when no day is covered', () => {
    // A registration that could not be read. The QR is still worth showing, so
    // this has to degrade rather than claim a day that may not be theirs.
    expect(passLabel(pass([day({ covered: false }), day({ day: 'day2', covered: false })]))).toBe('Pass');
  });
});

describe('dayStatus', () => {
  it('says a day is not on the ticket', () => {
    expect(dayStatus(day({ covered: false }))).toBe('Not on your ticket');
  });

  it('says not checked in yet for a covered day', () => {
    expect(dayStatus(day())).toBe('Not checked in yet');
  });

  it('says checked in once they have arrived', () => {
    expect(dayStatus(day({ arrived: true, present: 'in' }))).toBe('Checked in');
  });

  it('keeps someone who stepped out checked in', () => {
    // Lunch does not un-arrive anybody. Saying "not checked in" here would read
    // as though the desk had lost their check-in, and send them back to queue.
    expect(dayStatus(day({ arrived: true, present: 'out' }))).toBe('Checked in · stepped out');
  });
});
