import { describe, expect, it } from 'vitest';
import { contactPage, type ContactPageInput } from './contact-page';

const REPLAY_3 = {
  slug: 'replay-3',
  start_date: '2026-09-12',
  end_date: '2026-09-13',
  venue: 'Indiqube Symphony, MG Road',
  photos_url: null as string | null,
};

const REPLAY_4 = { start_date: '2027-03-06', end_date: '2027-03-07', venue: 'TBD' };

const wrapped: ContactPageInput = { phase: 'wrapped', edition: REPLAY_3, recap: REPLAY_3 };

function categories(input: ContactPageInput): string[] {
  return [...new Set(contactPage(input).faqs.map((faq) => faq.category))];
}

function answer(input: ContactPageInput, question: RegExp): string | undefined {
  return contactPage(input).faqs.find((faq) => question.test(faq.question))?.answer;
}

describe('contactPage — in season', () => {
  it('plans for the coming edition', () => {
    const view = contactPage({ phase: 'pre_event', edition: REPLAY_3, recap: null });
    expect(view.heroBody).toBe('Planning for Sep 12–13, 2026? Start with the answers below, then contact the REPLAY team if your question is specific to you.');
    expect(view.heroNotify).toBeNull();
    expect(view.showHelpNotice).toBe(true);
    expect(view.stuckLink.href).toBe('/plan-your-visit');
    expect(answer({ phase: 'pre_event', edition: REPLAY_3, recap: null }, /Where is the event/)).toBe(
      'Indiqube Symphony, MG Road, Bangalore. See Plan Your Visit for the current map and arrival guidance.',
    );
  });

  it('keeps the ticket questions', () => {
    expect(categories({ phase: 'pre_event', edition: REPLAY_3, recap: null })).toEqual(['The event', 'Tickets', 'Programme', 'Venue + access']);
  });

  it('stays on the coming edition even with a finished one to recap', () => {
    const view = contactPage({ phase: 'pre_event', edition: REPLAY_4, recap: REPLAY_3 });
    expect(view.heroBody).toMatch(/^Planning for Mar 6–7, 2027\?/);
    expect(answer({ phase: 'pre_event', edition: REPLAY_4, recap: REPLAY_3 }, /Where is the event/)).toMatch(/still being confirmed/);
    expect(JSON.stringify(view)).not.toMatch(/REPLAY 3E/);
  });

  it('falls back when there is no edition at all', () => {
    const view = contactPage({ phase: 'none', edition: null, recap: null });
    expect(view.heroBody).toBe('Start with the answers below, then contact the REPLAY team if your question is specific to you.');
    expect(answer({ phase: 'none', edition: null, recap: null }, /Where is the event/)).toMatch(/still being confirmed/);
  });
});

describe('contactPage — between editions', () => {
  const view = contactPage(wrapped);

  it('says the edition is over, and points at the next one', () => {
    expect(view.heroBody).toBe('REPLAY 3E wrapped on Sep 13. Questions about it, or about REPLAY 4E? Start with the answers below, then contact the REPLAY team.');
    expect(view.heroNotify).toEqual({ text: 'Get REPLAY 4E dates first →', href: '/tickets' });
    expect(view.showHelpNotice).toBe(false);
    expect(view.stuckLink).toEqual({ text: 'What was on →', href: '/schedule' });
  });

  it('asks about the next edition and the last one, never about tickets', () => {
    expect(categories(wrapped)).toEqual(['Next edition', 'After REPLAY 3E', 'About REPLAY']);
  });

  it('promises nothing about a weekend that is over', () => {
    const copy = JSON.stringify(view);
    expect(copy).not.toMatch(/Planning for|before doors open|before ticket sales open|still being confirmed|will be published/i);
    expect(copy).not.toMatch(/\bpass(es)?\b|Guild Path|refund|same-day|book a booth/i);
    expect(copy).not.toMatch(/plan.your.visit/i);
  });

  it('puts the venue in the past tense', () => {
    expect(answer(wrapped, /Where will REPLAY 4E be/)).toBe(
      "REPLAY 4E's venue is announced with its dates. REPLAY 3E was at Indiqube Symphony, MG Road, Bangalore.",
    );
  });

  it('leaves out a venue that was never confirmed', () => {
    const tbd = { ...REPLAY_3, venue: 'TBD' };
    expect(answer({ phase: 'wrapped', edition: tbd, recap: tbd }, /Where will/)).toBe("REPLAY 4E's venue is announced with its dates.");
  });

  it('says the photos are coming until there is an album', () => {
    expect(answer(wrapped, /photos from/)).toBe("REPLAY 3E's photos are being sorted. They go up on the Photos page as soon as they're ready.");
    const withAlbum = { ...REPLAY_3, photos_url: 'https://photos.app.goo.gl/abc123' };
    expect(answer({ phase: 'wrapped', edition: withAlbum, recap: withAlbum }, /photos from/)).toBe("REPLAY 3E's photos are on the Photos page.");
  });

  it('gives somebody in a photo a way to have it taken down', () => {
    expect(answer(wrapped, /taken down/)).toMatch(/hello@replaycon\.in/);
  });

  it('holds when a draft REPLAY 4E is current and unpublished', () => {
    expect(contactPage({ phase: 'wrapped', edition: null, recap: REPLAY_3 })).toEqual(view);
  });
});
