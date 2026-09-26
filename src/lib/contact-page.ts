// src/lib/contact-page.ts
//
// Everything the Contact Us page says that depends on where the site is in the
// edition cycle, decided in one place and tested without a page.
//
// In season the page answers somebody about to buy a ticket. Between editions
// nobody can buy one, and the people asking are the ones who were just there —
// photos, receipts, feedback — or the ones waiting for the next dates. So the
// ticket questions give way to theirs, and nothing promises what will happen
// "before doors open".
//
// Design: docs/specs/2026-09-24-between-editions-design.md

import { publicDateRange, shortDate } from './data';
import { albumHost } from './photos';
import { editionLabel, nextEditionLabel, type SitePhase } from './site-phase';
import type { EditionRow } from './types';

export interface ContactFaq {
  category: string;
  question: string;
  answer: string;
}

interface ContactLink {
  text: string;
  href: string;
}

export interface ContactPageInput {
  phase: SitePhase;
  /** The current, published edition, whatever its dates. */
  edition: Pick<EditionRow, 'start_date' | 'end_date' | 'venue'> | null;
  /** The most recent published edition that has ended. */
  recap: (Pick<EditionRow, 'slug' | 'end_date' | 'venue'> & { photos_url?: string | null }) | null;
}

export interface ContactPageView {
  description: string;
  heroBody: string;
  /** A second hero button: between editions, the way to hear about the next one. */
  heroNotify: ContactLink | null;
  emailKicker: string;
  emailBody: string;
  communityBody: string;
  partnerBody: string;
  /** The same-day help notice only means anything while an edition is coming. */
  showHelpNotice: boolean;
  faqs: ContactFaq[];
  stuckCopy: string;
  stuckLink: ContactLink;
}

const EMAIL = 'hello@replaycon.in';

const FIRST_TIMERS: ContactFaq = {
  category: 'The event',
  question: 'Is REPLAY friendly for first-time players?',
  answer: 'Yes. You do not need to know the games or arrive with a group. Ask the team for an orientation and help finding a suitable table.',
};

const OWN_GAMES: ContactFaq = {
  category: 'The event',
  question: 'Can I bring my own games?',
  answer: 'Yes. Label anything you bring and keep personal games separate from the REPLAY library returns area.',
};

export function contactPage(input: ContactPageInput): ContactPageView {
  const { phase, recap } = input;
  return phase === 'wrapped' && recap ? betweenEditions(recap) : inSeason(input.edition);
}

function inSeason(edition: ContactPageInput['edition']): ContactPageView {
  const range = edition ? publicDateRange(edition.start_date, edition.end_date) : '';
  return {
    description: 'Answers to common REPLAY ticket, programme, venue and accessibility questions, plus the right way to contact the team.',
    heroBody: edition
      ? `Planning for ${range}? Start with the answers below, then contact the REPLAY team if your question is specific to you.`
      : 'Start with the answers below, then contact the REPLAY team if your question is specific to you.',
    heroNotify: null,
    emailKicker: 'Tickets + general help',
    emailBody: 'Best for registration, payment, venue, accessibility and organiser questions.',
    communityBody: 'Meet the wider community. This group is not the official route for ticket or same-day support.',
    partnerBody: 'Run an event, book a booth, sponsor REPLAY or cover the weekend as a creator.',
    showHelpNotice: true,
    faqs: [
      FIRST_TIMERS,
      {
        category: 'The event',
        question: 'Can I come alone?',
        answer: 'Yes. Open play and hosted activities are designed to help people join tables. The final schedule will identify anything that needs advance sign-up.',
      },
      OWN_GAMES,
      {
        category: 'The event',
        question: 'Can I borrow games at REPLAY?',
        answer: 'Yes. The shared library has 200+ games for on-site play. The event-day app will support search and borrowing; collection, loan and return details will be published before doors open.',
      },
      {
        category: 'Tickets',
        question: 'What is the difference between a 1-day pass and a 2-day pass?',
        answer: 'A 1-day pass covers either selected event day at the same price. A 2-day pass covers both event days. Both include convention entry and access to the public programme, subject to individual activity capacity.',
      },
      {
        category: 'Tickets',
        question: 'When is my ticket confirmed?',
        answer: 'If payment is required, your registration remains pending until the REPLAY team reviews the payment. The confirmation email is your final ticket record.',
      },
      {
        category: 'Tickets',
        question: 'How do Guild Path discounts work?',
        answer: 'Use the phone number linked to your active BGC Guild Path membership. The first eligible REPLAY ticket receives the tier benefit automatically; the same membership cannot be split across repeat discounted bookings.',
      },
      {
        category: 'Tickets',
        question: 'What is the cancellation and refund policy?',
        answer: `Cancel up to 24 hours before the event starts and you get a full refund to the payment method you used. After that deadline cancellations are not accepted. Tickets cannot be transferred to another person. Email ${EMAIL} from your registered address, or message the team on WhatsApp, to cancel a booking.`,
      },
      {
        category: 'Programme',
        question: 'Does a ticket guarantee every hosted activity?',
        answer: 'No. The ticket covers convention entry. Individual events may have their own capacity or sign-up rules, which will be stated on the schedule.',
      },
      {
        category: 'Programme',
        question: 'Can I run an event or demonstration?',
        answer: 'Yes, proposals are welcome. Use the Get Involved page to tell the team what you want to run, its duration, player capacity and what support you need.',
      },
      {
        category: 'Venue + access',
        question: 'Where is the event?',
        answer: edition && edition.venue !== 'TBD'
          ? `${edition.venue}, Bangalore. See Plan Your Visit for the current map and arrival guidance.`
          : 'The Bangalore venue and full address are still being confirmed. They will be published before ticket sales open.',
      },
      {
        category: 'Venue + access',
        question: 'What accessibility support is available?',
        answer: `Venue-specific accessibility details are still being confirmed. Email ${EMAIL} with your requirements so the team can plan and give you a precise answer.`,
      },
      {
        category: 'Venue + access',
        question: 'Can children attend?',
        answer: 'The age and guardian policy is not final yet. It will be published before ticket sales open, along with any age restrictions on individual sessions.',
      },
    ],
    stuckCopy: 'Include your registered phone number or ticket reference for booking questions. For accessibility, tell us the outcome you need rather than sharing unnecessary personal or medical details.',
    stuckLink: { text: 'Plan your visit →', href: '/plan-your-visit' },
  };
}

function betweenEditions(recap: NonNullable<ContactPageInput['recap']>): ContactPageView {
  const label = editionLabel(recap.slug);
  const next = nextEditionLabel(recap.slug);
  const after = `After ${label}`;
  const about = 'About REPLAY';

  return {
    description: `Questions about ${label}, its photos or ${next}, plus the right way to contact the REPLAY team.`,
    heroBody: `${label} wrapped on ${shortDate(recap.end_date)}. Questions about it, or about ${next}? Start with the answers below, then contact the REPLAY team.`,
    heroNotify: { text: `Get ${next} dates first →`, href: '/tickets' },
    emailKicker: 'General help',
    emailBody: `Best for questions about ${label}, partnering on ${next}, and anything else for the organisers.`,
    communityBody: 'Meet the wider community between editions.',
    partnerBody: `Sponsor, exhibit or run something at ${next}. Booths go back on sale with its dates.`,
    showHelpNotice: false,
    faqs: [
      {
        category: 'Next edition',
        question: `When is ${next}?`,
        answer: "Dates aren't set yet. Leave your number under Get notified and you'll hear the moment tickets open, before it's on Instagram.",
      },
      {
        category: 'Next edition',
        question: `Where will ${next} be?`,
        answer: recap.venue !== 'TBD'
          ? `${next}'s venue is announced with its dates. ${label} was at ${recap.venue}, Bangalore.`
          : `${next}'s venue is announced with its dates.`,
      },
      {
        category: 'Next edition',
        question: `Can I sponsor, exhibit or run something at ${next}?`,
        answer: `Yes. Sponsorship and activity proposals are open now: see Get Involved, or message the team on WhatsApp. Booths and community-engagement slots go back on sale once ${next} has dates and a venue.`,
      },
      {
        category: after,
        question: `Where are the photos from ${label}?`,
        answer: albumHost(recap.photos_url)
          ? `${label}'s photos are on the Photos page.`
          : `${label}'s photos are being sorted. They go up on the Photos page as soon as they're ready.`,
      },
      {
        category: after,
        question: "I'm in a photo and would like it taken down.",
        answer: `Email ${EMAIL} with a link to the photo and the team will take it down.`,
      },
      {
        category: after,
        question: 'Can I get a receipt for my ticket?',
        answer: `Your confirmation email is the record of your ticket. If you need something more formal, email ${EMAIL} with the phone number you registered with.`,
      },
      {
        category: after,
        question: `How do I share feedback on ${label}?`,
        answer: `Email ${EMAIL} or message the team on WhatsApp. What worked, what didn't and what you would want at ${next} are all useful.`,
      },
      { ...FIRST_TIMERS, category: about },
      {
        category: about,
        question: 'Can I come alone?',
        answer: 'Yes. Open play and hosted activities are designed to help people join tables.',
      },
      { ...OWN_GAMES, category: about },
      {
        category: about,
        question: 'Can I borrow games at REPLAY?',
        answer: 'Yes. At the event, games are borrowed from the library desk and returned there when you finish. The Game library page lists every game on the shelf.',
      },
    ],
    stuckCopy: `For a question about your ${label} ticket, include the phone number you registered with. For a photo, a link to it is all the team needs.`,
    stuckLink: { text: 'What was on →', href: '/schedule' },
  };
}
