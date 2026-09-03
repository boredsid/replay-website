import { describe, it, expect } from 'vitest';
import { minutesLeft, dueLabel, requestErrorMessage } from './library';

const NOW = Date.parse('2026-09-12T12:00:00Z');
const at = (minutes: number) => new Date(NOW + minutes * 60_000).toISOString();

describe('minutesLeft', () => {
  it('rounds up, so four and a half minutes reads as five', () => {
    // Rounding down would show "4 min" the instant a five-minute hold starts.
    expect(minutesLeft(at(4.5), NOW)).toBe(5);
  });

  it('never goes negative', () => {
    // Expiry is lazy, so a lapsed hold can still be on screen. "-3 min to
    // collect it" is not a thing to show anybody.
    expect(minutesLeft(at(-3), NOW)).toBe(0);
  });
});

describe('dueLabel', () => {
  it('says minutes under the hour', () => {
    expect(dueLabel(at(45), NOW)).toBe('45m left');
  });

  it('says hours and minutes over it', () => {
    expect(dueLabel(at(200), NOW)).toBe('3h 20m left');
  });

  it('drops the minutes when there are none', () => {
    expect(dueLabel(at(240), NOW)).toBe('4h left');
  });

  it('says due now once the clock runs out', () => {
    expect(dueLabel(at(-10), NOW)).toBe('Due now');
    expect(dueLabel(at(0), NOW)).toBe('Due now');
  });

  it('says nothing without a due time', () => {
    expect(dueLabel(null, NOW)).toBe('');
  });
});

describe('requestErrorMessage', () => {
  it('tells someone what to do, not what went wrong', () => {
    expect(requestErrorMessage('not_checked_in')).toMatch(/Check in at the desk/);
    expect(requestErrorMessage('no_copy_available')).toMatch(/Try another game/);
    expect(requestErrorMessage('already_holding')).toMatch(/Bring it back/);
  });

  it('does not blame the attendee for the library closing', () => {
    expect(requestErrorMessage('library_last_call')).toBe('The library has stopped lending for today.');
  });

  it('sends an expired pairing back to the desk rather than saying 401', () => {
    expect(requestErrorMessage('unauthorised')).toMatch(/ask the desk for a new code/i);
  });

  it('has something to say for a failure it does not recognise', () => {
    expect(requestErrorMessage('failed')).toBe('That did not work. Try again.');
  });
});
