// Folding check-in events into answers.
//
// `check_in_events` is append-only: re-entry is a new row, and undo is a new row
// naming the row it cancels. Nothing is ever updated, so every question about an
// attendee is answered by folding their events rather than by reading a flag.
//
// There are two different questions here and they must not be merged. Someone
// who stepped out for lunch is not currently inside, but has still arrived
// today and must not lose the ability to pair a device or book a session.

export type EventDay = 'day1' | 'day2';
export type EventKind = 'in' | 'out';

export interface CheckInEvent {
  id: string;
  day: EventDay;
  kind: EventKind;
  voids_event_id: string | null;
  occurred_at: string;
}

/** Presence right now, for the desk to display. `null` means never arrived. */
export type Presence = EventKind | null;

export type DayState = Record<EventDay, Presence>;

/**
 * Drops both halves of every undo: the cancelling row and the row it cancels.
 *
 * A row carrying `voids_event_id` is a tombstone, never a state change of its
 * own. To reverse an undo, record a fresh event rather than voiding the
 * tombstone — that keeps this a single pass with no chains to walk.
 */
function liveEvents(events: readonly CheckInEvent[]): CheckInEvent[] {
  const voided = new Set<string>();
  for (const event of events) {
    if (event.voids_event_id) voided.add(event.voids_event_id);
  }
  return events.filter((event) => !event.voids_event_id && !voided.has(event.id));
}

function byTime(a: CheckInEvent, b: CheckInEvent): number {
  const delta = Date.parse(a.occurred_at) - Date.parse(b.occurred_at);
  // Ties are broken by id so the fold is deterministic. Two events can share a
  // timestamp when an offline queue flushes a batch on reconnect.
  return delta !== 0 ? delta : a.id.localeCompare(b.id);
}

/**
 * Where the attendee is now, per day. The last live event of each day wins.
 */
export function currentState(events: readonly CheckInEvent[]): DayState {
  const state: DayState = { day1: null, day2: null };
  for (const event of liveEvents(events).sort(byTime)) {
    state[event.day] = event.kind;
  }
  return state;
}

/**
 * Whether the attendee arrived on this day at all — regardless of a later exit.
 *
 * This gates pairing and session sign-ups. It deliberately ignores whether they
 * are inside at this moment: stepping out for lunch, or an exit recorded at a
 * door, must not revoke someone's ability to book.
 */
export function hasArrivedOn(events: readonly CheckInEvent[], day: EventDay): boolean {
  return liveEvents(events).some((event) => event.day === day && event.kind === 'in');
}

/**
 * The next check-in action for a day: someone outside checks in, someone inside
 * checks out. Keeps the desk to a single button whose meaning is unambiguous.
 */
export function nextKind(events: readonly CheckInEvent[], day: EventDay): EventKind {
  return currentState(events)[day] === 'in' ? 'out' : 'in';
}
