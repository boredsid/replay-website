export type SponsorTierKey =
  | 'title'
  | 'association'
  | 'zone'
  | 'gaming'
  | 'venue';

// Most deliverables are common to every tier, so listing them per tier repeated
// the same five lines five times. They are stated once here, and each tier
// carries only what it adds on top. The full staged specification — the same
// deliverables grouped before / in the room / in the play / after — lives in
// `docs/SPONSORSHIP.md`, which is what the partner deck is built from.
export const SPONSOR_BASELINE: string[] = [
  'A dedicated announcement post, plus one co-created content piece',
  'Your logo on the REPLAY website',
  'Two large-format banners in prime positions',
  'An insert in the welcome kit',
  'Named in the post-event recap',
];

export interface SponsorTier {
  key: SponsorTierKey;
  /** Public tier name. */
  name: string;
  /** How the credit reads in copy, when the tier carries one. */
  billing?: string;
  /** Cash ask in rupees. Null hides the figure on the page entirely. */
  price: number | null;
  /** Replaces the default “+ GST” line. Stands in for the price when it is null. */
  priceNote?: string;
  /** How many brands can hold this tier in one edition. */
  slots: string;
  /** One line on who the tier is for. */
  summary: string;
  /** What this tier adds on top of `SPONSOR_BASELINE`. */
  adds: string[];
  /** Complimentary two-day passes. */
  passes: number;
  /** Set when the tier is no longer open for the current edition. */
  status?: { label: string; detail: string };
}

export const SPONSOR_TIERS: SponsorTier[] = [
  {
    key: 'title',
    name: 'Title sponsor',
    billing: '“X presents REPLAY”',
    price: 100000,
    slots: 'One brand, exclusive',
    summary: 'Your name in front of the event, everywhere it appears.',
    adds: [
      'The “presents REPLAY” lockup on every creative, the site header and the ticket page',
      'The main backdrop and the entrance arch',
      'Wristband branding',
      'The welcome kit co-branded, with a branded item of yours inside',
      'Four standees, a premium booth, a named zone on the floor map',
      'Named in attendee emails, from registration to know-before-you-go',
      'A named signature event, with headline prize credit',
      'Branded photo and video you can use',
      'First refusal on the tier next edition',
    ],
    passes: 10,
  },
  {
    key: 'association',
    name: 'In association with',
    billing: '“REPLAY in association with X”',
    price: 25000,
    slots: 'One brand, exclusive',
    summary: 'Your name alongside the event name, on every creative.',
    adds: [
      'The “in association with” lockup on every creative, the site header and the ticket page',
      'Wristband branding',
      'The welcome kit co-branded, with a branded item of yours inside',
      'Four standees, a premium booth, a named zone on the floor map',
      'Named in attendee emails, from registration to know-before-you-go',
      'A named signature event, with headline prize credit',
      'Branded photo and video you can use',
      'First refusal on the tier next edition',
    ],
    passes: 4,
  },
  {
    key: 'zone',
    name: 'Zone partner',
    billing: '“The [Zone] presented by X”',
    price: 15000,
    priceNote: '+ GST · both days',
    slots: 'Up to three brands, one zone each',
    summary:
      'Your name on one room within the room — the arena, the TTRPG den, the library or the family corner.',
    adds: [
      'Zone naming wherever the programme is published',
      'Wristband branding',
      'Three standees, and a named zone on the floor map',
      'A named signature event',
    ],
    passes: 2,
  },
  {
    key: 'gaming',
    name: 'Gaming partner',
    price: 10000,
    priceNote: '+ GST · both days',
    slots: 'Open to several brands',
    summary: 'For the venues and play spaces that host the community between editions.',
    adds: ['Two standees', 'A named signature event'],
    passes: 2,
  },
  {
    key: 'venue',
    name: 'Venue partner',
    billing: '“Hosted at X”',
    price: null,
    priceNote: 'In kind',
    slots: 'One venue',
    summary: 'The space that makes a two-day, multi-room convention possible.',
    adds: [
      'The “hosted at” credit on directions, maps and the know-before-you-go',
      'Named in attendee emails, from registration to know-before-you-go',
    ],
    passes: 6,
    status: {
      label: 'Closed for REPLAY 3rd Edition',
      detail: 'IndiQube Symphony, MG Road is the venue partner for this edition.',
    },
  },
];
