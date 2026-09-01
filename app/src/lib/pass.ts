// The attendee's ticket, as opposed to their identity.
//
// The device already knows who someone is — that came back with the pairing and
// is drawn offline. What it cannot know is what they bought or whether the desk
// has seen them today, because both change after pairing and only the server
// has them.

import { API_BASE } from './api';
import { formatDate } from './event-time';
import type { Device } from './device';

export type EventDay = 'day1' | 'day2';

export interface PassDay {
  day: EventDay;
  date: string;
  /** Whether the ticket covers this day at all. */
  covered: boolean;
  /** Arrived at some point, even if they have since stepped out. */
  arrived: boolean;
  present: 'in' | 'out' | null;
}

export interface Pass {
  display_name: string | null;
  seat_index: number;
  pass_type: string | null;
  days: PassDay[];
}

/**
 * Fetches the pass, or null when it could not be fetched.
 *
 * Null is deliberately not an error state for the caller to render. The ID
 * screen's job at a door is to show a QR, and it can do that from what the
 * device already holds — a venue network that dropped should cost the ticket
 * detail, never the pass itself.
 */
export async function fetchPass(device: Device): Promise<Pass | null> {
  try {
    const response = await fetch(`${API_BASE}/api/app/me/pass`, {
      headers: { Authorization: `Bearer ${device.token}` },
      cache: 'no-store',
    });
    if (!response.ok) return null;
    const body = await response.json() as Pass;
    return Array.isArray(body.days) ? body : null;
  } catch {
    return null;
  }
}

/** What a pass covering these days should be called. */
export function passLabel(pass: Pass): string {
  const covered = pass.days.filter((day) => day.covered);
  if (covered.length === 0) return 'Pass';
  if (covered.length > 1) return 'Both days';
  return `${dayName(covered[0])} only`;
}

/**
 * "Sat, 12 Sept" — through the same formatter the schedule cards use.
 *
 * Two date formats on one screen read as two different apps, so this defers to
 * `formatDate` rather than growing a second opinion about how a day looks.
 */
export function dayName(day: PassDay): string {
  try {
    return formatDate(day.date);
  } catch {
    // Intl throws RangeError on an unparseable date rather than printing
    // anything, so a malformed date from the server would take the ID screen
    // down with it. A day number is a poor label and a fine fallback.
    return day.day === 'day1' ? 'Day 1' : 'Day 2';
  }
}

/** One line saying where this day stands, in the attendee's own terms. */
export function dayStatus(day: PassDay): string {
  if (!day.covered) return 'Not on your ticket';
  if (!day.arrived) return 'Not checked in yet';
  // Someone who stepped out has still arrived, and telling them otherwise would
  // read as though their check-in had been lost.
  return day.present === 'out' ? 'Checked in · stepped out' : 'Checked in';
}
