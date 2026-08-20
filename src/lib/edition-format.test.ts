import { describe, expect, it } from 'vitest';
import { calendarDate, clockTime, eventDayLabel, weekdayName } from './edition-format';

describe('edition display formatting', () => {
  it('derives weekday labels from ISO dates', () => {
    expect(weekdayName('2026-09-12')).toBe('Saturday');
    expect(weekdayName('2026-09-13')).toBe('Sunday');
    expect(eventDayLabel('2026-09-12')).toBe('Saturday, Sep 12');
    expect(calendarDate('2026-09-12')).toBe('Sep 12, 2026');
  });

  it('formats edition times without relying on the browser timezone', () => {
    expect(clockTime('10:00:00')).toBe('10 AM');
    expect(clockTime('19:30:00')).toBe('7:30 PM');
    expect(clockTime('00:00:00')).toBe('12 AM');
    expect(clockTime('12:00:00')).toBe('12 PM');
  });
});
