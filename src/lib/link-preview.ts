// src/lib/link-preview.ts
// Copy decisions for the social link-preview card, kept free of `sharp` so
// they can be unit-tested without image fixtures. The pixels live in
// `scripts/render-link-preview.ts`; everything here is "what does the card
// say", never "where does it sit".
import type { EditionRow } from './types';
import { editionOrdinal } from './data';

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
const WEEKDAYS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];

export const LINK_PREVIEW_TAGLINE = 'Bangalore’s Offline Gaming Convention';

export interface LinkPreviewField {
  label: string;
  /** One or two lines — long venue names wrap rather than shrinking. */
  value: string[];
  note: string;
}

export interface LinkPreviewContent {
  /** "3RD EDITION", or null when there is no published edition to name. */
  eyebrow: string | null;
  tagline: string;
  when: LinkPreviewField | null;
  where: LinkPreviewField | null;
}

function parseIsoDate(iso: string): { year: number; month: number; day: number } | null {
  const match = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (!MONTHS[month - 1] || day < 1 || day > 31) return null;
  return { year, month, day };
}

/**
 * "2026-09-12" + "2026-09-13" → "SEP 12–13". A card this small has no room
 * for the year, and the month repeats only when the dates straddle one.
 */
export function previewDateRange(start: string, end: string): string {
  const from = parseIsoDate(start);
  const to = parseIsoDate(end);
  if (!from || !to) return `${start} – ${end}`;
  const fromLabel = `${MONTHS[from.month - 1]} ${from.day}`;
  if (from.year === to.year && from.month === to.month && from.day === to.day) return fromLabel;
  if (from.year === to.year && from.month === to.month) return `${fromLabel}–${to.day}`;
  return `${fromLabel} – ${MONTHS[to.month - 1]} ${to.day}`;
}

/** "2026-09-12" + "2026-09-13" → "SAT & SUN"; a one-day edition → "SAT". */
export function previewDayNote(start: string, end: string): string {
  const from = parseIsoDate(start);
  const to = parseIsoDate(end);
  if (!from || !to) return '';
  const name = (d: { year: number; month: number; day: number }) =>
    WEEKDAYS[new Date(Date.UTC(d.year, d.month - 1, d.day)).getUTCDay()];
  const first = name(from);
  const last = name(to);
  return first === last && start === end ? first : `${first} & ${last}`;
}

/**
 * Editions store the venue as "Indiqube Symphony, MG Road" — a name plus the
 * locality Bangaloreans actually navigate by. Split on the last comma so the
 * locality can sit under the name in smaller type.
 */
export function splitVenue(venue: string): { name: string; locality: string } {
  const trimmed = venue.trim();
  if (!trimmed || trimmed.toUpperCase() === 'TBD') return { name: 'Venue to be announced', locality: 'Bangalore' };
  const comma = trimmed.lastIndexOf(',');
  if (comma === -1) return { name: trimmed, locality: 'Bangalore' };
  const name = trimmed.slice(0, comma).trim();
  const locality = trimmed.slice(comma + 1).trim();
  if (!name || !locality) return { name: trimmed, locality: 'Bangalore' };
  return { name, locality };
}

/**
 * Break `text` across at most `maxLines` lines of roughly `maxChars`, keeping
 * the lines as even as the word boundaries allow. Anything that still will not
 * fit is left on the final line — the renderer would rather set one long line
 * than drop half a venue name.
 */
export function wrapToLines(text: string, maxChars: number, maxLines: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length === 0) return [''];
  if (text.length <= maxChars || maxLines < 2 || words.length === 1) return [text];

  // Pack greedily at a given line budget; used as the feasibility test below.
  const pack = (limit: number): string[] => {
    const lines: string[] = [];
    let current = words[0];
    for (const word of words.slice(1)) {
      const candidate = `${current} ${word}`;
      if (candidate.length > limit) {
        lines.push(current);
        current = word;
      } else {
        current = candidate;
      }
    }
    lines.push(current);
    return lines;
  };

  // Binary-search the narrowest budget that still fits in `maxLines`, so the
  // lines come out as even as possible — "THE BANGALORE / LOCAL", not
  // "THE / BANGALORE LOCAL". Long text simply gets a wider budget; the
  // renderer shrinks the type rather than dropping words.
  let low = Math.max(...words.map((word) => word.length));
  let high = text.length;
  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    if (pack(mid).length <= maxLines) high = mid;
    else low = mid + 1;
  }
  return pack(low);
}

export function linkPreviewContent(edition: EditionRow | null): LinkPreviewContent {
  if (!edition) {
    return { eyebrow: null, tagline: LINK_PREVIEW_TAGLINE, when: null, where: null };
  }
  const { name, locality } = splitVenue(edition.venue);
  return {
    eyebrow: editionOrdinal(edition.slug).toUpperCase() || null,
    tagline: LINK_PREVIEW_TAGLINE,
    when: {
      label: 'WHEN',
      value: [previewDateRange(edition.start_date, edition.end_date)],
      note: previewDayNote(edition.start_date, edition.end_date),
    },
    where: {
      label: 'WHERE',
      value: wrapToLines(name.toUpperCase(), 18, 2),
      note: locality.toUpperCase(),
    },
  };
}
