import { describe, it, expect } from 'vitest';
import { currentState, hasArrivedOn, lastEventPerDay, nextKind, type CheckInEvent } from './check-in-state';

let seq = 0;
function event(partial: Partial<CheckInEvent> & Pick<CheckInEvent, 'kind'>): CheckInEvent {
  seq += 1;
  return {
    id: `e${seq}`,
    day: 'day1',
    voids_event_id: null,
    // One minute apart, in creation order, unless a test overrides it.
    occurred_at: new Date(Date.UTC(2026, 8, 12, 9, seq)).toISOString(),
    ...partial,
  };
}

describe('currentState', () => {
  it('reports null for a day with no events', () => {
    expect(currentState([])).toEqual({ day1: null, day2: null });
  });

  it('reports the last event of each day independently', () => {
    const events = [
      event({ kind: 'in', day: 'day1' }),
      event({ kind: 'out', day: 'day1' }),
      event({ kind: 'in', day: 'day2' }),
    ];
    expect(currentState(events)).toEqual({ day1: 'out', day2: 'in' });
  });

  it('follows re-entry back to inside', () => {
    const events = [
      event({ kind: 'in' }),
      event({ kind: 'out' }),
      event({ kind: 'in' }),
    ];
    expect(currentState(events).day1).toBe('in');
  });

  it('ignores an event that a later row voids, and the voiding row itself', () => {
    const mistake = event({ kind: 'in' });
    const undo = event({ kind: 'in', voids_event_id: mistake.id });
    expect(currentState([mistake, undo]).day1).toBeNull();
  });

  it('voids the right event when several exist', () => {
    const arrival = event({ kind: 'in' });
    const wrongExit = event({ kind: 'out' });
    const undo = event({ kind: 'out', voids_event_id: wrongExit.id });
    // The exit was a mistake, so they are still inside.
    expect(currentState([arrival, wrongExit, undo]).day1).toBe('in');
  });

  it('does not depend on the order rows arrive in', () => {
    const first = event({ kind: 'in' });
    const second = event({ kind: 'out' });
    expect(currentState([second, first]).day1).toBe('out');
  });

  it('is deterministic when two events share a timestamp', () => {
    const stamp = '2026-09-12T09:00:00.000Z';
    const a: CheckInEvent = { id: 'a', day: 'day1', kind: 'in', voids_event_id: null, occurred_at: stamp };
    const b: CheckInEvent = { id: 'b', day: 'day1', kind: 'out', voids_event_id: null, occurred_at: stamp };
    expect(currentState([a, b]).day1).toBe(currentState([b, a]).day1);
  });
});

describe('hasArrivedOn', () => {
  it('is false with no events', () => {
    expect(hasArrivedOn([], 'day1')).toBe(false);
  });

  it('stays true after the attendee steps out', () => {
    const events = [event({ kind: 'in' }), event({ kind: 'out' })];
    // The whole point: lunch must not revoke pairing or the ability to book.
    expect(currentState(events).day1).toBe('out');
    expect(hasArrivedOn(events, 'day1')).toBe(true);
  });

  it('does not leak across days', () => {
    const events = [event({ kind: 'in', day: 'day1' })];
    expect(hasArrivedOn(events, 'day1')).toBe(true);
    expect(hasArrivedOn(events, 'day2')).toBe(false);
  });

  it('is false once the only arrival is voided', () => {
    const arrival = event({ kind: 'in' });
    const undo = event({ kind: 'in', voids_event_id: arrival.id });
    expect(hasArrivedOn([arrival, undo], 'day1')).toBe(false);
  });

  it('stays true when a second arrival survives the void', () => {
    const first = event({ kind: 'in' });
    const undo = event({ kind: 'in', voids_event_id: first.id });
    const second = event({ kind: 'in' });
    expect(hasArrivedOn([first, undo, second], 'day1')).toBe(true);
  });
});

describe('lastEventPerDay', () => {
  it('has nothing to undo before anyone arrives', () => {
    expect(lastEventPerDay([])).toEqual({ day1: null, day2: null });
  });

  it('offers the most recent event of each day', () => {
    const a = event({ kind: 'in', day: 'day1' });
    const b = event({ kind: 'out', day: 'day1' });
    const c = event({ kind: 'in', day: 'day2' });
    expect(lastEventPerDay([a, b, c])).toEqual({ day1: b.id, day2: c.id });
  });

  it('falls back to the surviving event after an undo', () => {
    const arrival = event({ kind: 'in' });
    const wrongExit = event({ kind: 'out' });
    const undo = event({ kind: 'out', voids_event_id: wrongExit.id });
    // Undoing the exit leaves the arrival as the next thing undo would cancel.
    expect(lastEventPerDay([arrival, wrongExit, undo]).day1).toBe(arrival.id);
  });

  it('offers nothing once every event is voided', () => {
    const arrival = event({ kind: 'in' });
    const undo = event({ kind: 'in', voids_event_id: arrival.id });
    expect(lastEventPerDay([arrival, undo]).day1).toBeNull();
  });
});

describe('nextKind', () => {
  it('checks in someone who has never arrived', () => {
    expect(nextKind([], 'day1')).toBe('in');
  });

  it('checks out someone who is inside', () => {
    expect(nextKind([event({ kind: 'in' })], 'day1')).toBe('out');
  });

  it('checks in someone who left and came back', () => {
    const events = [event({ kind: 'in' }), event({ kind: 'out' })];
    expect(nextKind(events, 'day1')).toBe('in');
  });

  it('is per day', () => {
    const events = [event({ kind: 'in', day: 'day1' })];
    expect(nextKind(events, 'day1')).toBe('out');
    expect(nextKind(events, 'day2')).toBe('in');
  });
});
