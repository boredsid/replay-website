// src/lib/recap.ts
//
// Every sentence the site says about a finished edition, decided in one place
// and tested without a page: the recap band, the "Last time" line, the
// off-season Get involved figures and the share card all read from here.
//
// The rule that shapes most of it: a figure that is zero or missing is left
// out, never shown as 0. REPLAY 1 and 2 were imported from spreadsheets before
// the attendee app existed and have no check-ins, bookings or loans.
//
// Design: docs/specs/2026-09-24-between-editions-design.md

import type { EditionRow, RecapResponse, ScheduleItemRow, SponsorRow } from './types';
import { publicDateRange } from './data';
import { clockTime, weekdayName } from './edition-format';
import { editionLabel, nextEditionLabel } from './site-phase';

export interface RecapTile {
  value: number;
  label: string;
}

export interface RecapLink {
  text: string;
  href: string;
}

export interface RecapView {
  /** "REPLAY 3" */
  label: string;
  /** "REPLAY 4" */
  nextLabel: string;
  eyebrow: string;
  headline: string;
  sub: string | null;
  tiles: RecapTile[];
  mostBorrowed: Array<{ title: string; loans: number; share: number }> | null;
  fullest: { title: string; when: string; host: string | null; booked: number } | null;
  credit: string | null;
  /** The first is the band's button; the rest are text links. */
  links: RecapLink[];
  lastTimeLine: { text: string; photos: RecapLink | null } | null;
  people: number | null;
  seatsBooked: number | null;
  partners: number | null;
  /** The lower of the two booth prices, before GST. */
  cheapestBooth: number;
}

export interface RecapInput {
  /** The recap edition: the most recent published edition that has ended. */
  edition: Pick<EditionRow, 'slug' | 'start_date' | 'end_date' | 'venue' | 'partner_pricing'> & { photos_url?: string | null };
  /** Null when the Worker could not be reached; the band still renders. */
  recap: RecapResponse | null;
  scheduleItems: ScheduleItemRow[];
  shelfCount: number | null;
  sponsors: Array<Pick<SponsorRow, 'name' | 'tier'> & { show_in_header?: boolean }>;
}

const PHOTOS_LINK: RecapLink = { text: 'See the photos →', href: '/photos' };

function positive(n: number | null | undefined): number | null {
  return typeof n === 'number' && Number.isFinite(n) && n > 0 ? n : null;
}

function daySpan(start: string, end: string): number {
  const s = Date.parse(`${start}T00:00:00Z`);
  const e = Date.parse(`${end}T00:00:00Z`);
  if (Number.isNaN(s) || Number.isNaN(e) || e < s) return 1;
  return Math.round((e - s) / 86_400_000) + 1;
}

const SPELLED = ['', 'One', 'Two', 'Three', 'Four', 'Five'];

function venueOf(venue: string): string | null {
  const v = venue?.trim();
  return v && v !== 'TBD' ? v : null;
}

/**
 * "Made in association with Meeple Syrup." The header lockup's credit, moved
 * here once the edition it was sold for is over. Only sponsors the console
 * still has switched on for the lockup are credited.
 */
export function recapCredit(sponsors: RecapInput['sponsors']): string | null {
  const credited = (tier: string) =>
    sponsors.filter((s) => s.tier === tier && s.show_in_header !== false).map((s) => s.name);
  const title = credited('title');
  const association = credited('association');
  const join = (names: string[]) => names.join(' and ');
  if (title.length && association.length) return `Presented by ${join(title)}, in association with ${join(association)}.`;
  if (title.length) return `Presented by ${join(title)}.`;
  if (association.length) return `Made in association with ${join(association)}.`;
  return null;
}

export function recapView(input: RecapInput): RecapView {
  const { edition, recap, scheduleItems, shelfCount, sponsors } = input;
  const label = editionLabel(edition.slug);
  const nextLabel = nextEditionLabel(edition.slug);
  const venue = venueOf(edition.venue);
  const days = daySpan(edition.start_date, edition.end_date);
  const hasAlbum = Boolean(edition.photos_url);

  const people = positive(recap?.attendance.people);
  const seatsBooked = positive(recap?.sessions.seats_booked);
  const sessionsBooked = positive(recap?.sessions.sessions_booked);
  const loans = positive(recap?.library.loans);
  const programme = positive(scheduleItems.filter((item) => item.public_status === 'published').length);
  const shelf = positive(shelfCount);
  const partners = positive(sponsors.length);

  // With a people figure the headline is the number, so the eyebrow names the
  // edition; without one the headline names it, and the eyebrow must not repeat it.
  const headline = people ? `${people} people came to play.` : `That was ${label}.`;
  const eyebrow = [people ? `That was ${label}` : label, publicDateRange(edition.start_date, edition.end_date), venue]
    .filter(Boolean)
    .join(' · ');

  const subParts: string[] = [];
  if (venue) subParts.push(`${SPELLED[days] ?? days} ${days === 1 ? 'day' : 'days'} at ${venue}.`);
  const day1 = positive(recap?.attendance.by_day.day1);
  const day2 = positive(recap?.attendance.by_day.day2);
  const bothDays = positive(recap?.attendance.both_days);
  if (days === 2 && day1 && day2 && bothDays && people) subParts.push(`${bothDays} of them came both days.`);
  const sub = subParts.length ? subParts.join(' ') : null;

  const tiles: RecapTile[] = [];
  if (people) tiles.push({ value: people, label: 'people through the door' });
  if (programme) tiles.push({ value: programme, label: 'things on the programme' });
  if (seatsBooked) {
    tiles.push({
      value: seatsBooked,
      label: sessionsBooked ? `seats booked across ${sessionsBooked} ${sessionsBooked === 1 ? 'session' : 'sessions'}` : 'seats booked',
    });
  }
  if (loans) tiles.push({ value: loans, label: 'games borrowed from the library' });
  if (shelf) tiles.push({ value: shelf, label: 'games on the shelf' });
  if (partners) tiles.push({ value: partners, label: partners === 1 ? 'partner on the floor' : 'partners on the floor' });

  const borrowed = (recap?.library.most_borrowed ?? []).filter((g) => g.title && g.loans > 0);
  const top = borrowed[0]?.loans ?? 0;
  const mostBorrowed = borrowed.length >= 3
    ? borrowed.map((g) => ({ title: g.title, loans: g.loans, share: top ? g.loans / top : 0 }))
    : null;

  let fullest: RecapView['fullest'] = null;
  const busiest = recap?.sessions.by_item.find((row) => row.booked > 0);
  if (busiest) {
    const item = scheduleItems.find((i) => i.id === busiest.schedule_item_id && i.public_status !== 'draft');
    if (item) {
      const when = [weekdayName(item.day), item.start_time ? clockTime(item.start_time) : null].filter(Boolean).join(', ');
      fullest = { title: item.title, when, host: item.host_name, booked: busiest.booked };
    }
  }

  const links: RecapLink[] = [{ text: `Get ${nextLabel} dates first →`, href: '/tickets' }];
  if (hasAlbum) links.push(PHOTOS_LINK);
  links.push({ text: 'What was on →', href: '/schedule' });

  const lastTimeLine = people
    ? { text: `Last time, ${people} people came to play at ${label}.`, photos: hasAlbum ? PHOTOS_LINK : null }
    : null;

  const booths = [edition.partner_pricing.standard_booth, edition.partner_pricing.community_booth].filter((n) => n > 0);

  return {
    label,
    nextLabel,
    eyebrow,
    headline,
    sub,
    tiles,
    mostBorrowed,
    fullest,
    credit: recapCredit(sponsors),
    links,
    lastTimeLine,
    people,
    seatsBooked,
    partners,
    cheapestBooth: booths.length ? Math.min(...booths) : 0,
  };
}

/** "₹6,500" */
export function rupees(amount: number): string {
  return `₹${amount.toLocaleString('en-IN')}`;
}
