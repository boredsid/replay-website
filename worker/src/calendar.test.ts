import { describe, expect, it } from 'vitest';
import { buildGoogleCalendarUrl, buildWhatsAppShareUrl } from './calendar';

const edition = {
  slug: 'replay-3',
  name: 'REPLAY',
  start_date: '2026-09-12',
  end_date: '2026-09-13',
  venue: 'The Foundry, Bangalore',
};

describe('buildGoogleCalendarUrl', () => {
  it('encodes start and end in UTC ISO basic format', () => {
    const url = buildGoogleCalendarUrl(edition);
    expect(url).toContain('dates=20260912T043000Z%2F20260913T133000Z');
  });
  it('URL-encodes the title with ordinal label', () => {
    const url = buildGoogleCalendarUrl(edition);
    expect(url).toContain('text=REPLAY%203rd%20edition');
  });
  it('URL-encodes the venue as location', () => {
    const url = buildGoogleCalendarUrl(edition);
    expect(url).toContain('location=The%20Foundry%2C%20Bangalore');
  });
  it('passes through TBD venue gracefully', () => {
    const tbdEdition = { ...edition, venue: 'TBD' };
    const url = buildGoogleCalendarUrl(tbdEdition);
    expect(url).toContain('location=TBD');
  });
});

describe('buildWhatsAppShareUrl', () => {
  it('includes edition ordinal name and site URL in prefilled text', () => {
    const url = buildWhatsAppShareUrl(edition);
    expect(url.startsWith('https://wa.me/?text=')).toBe(true);
    const text = decodeURIComponent(url.split('text=')[1]);
    expect(text).toContain('REPLAY 3rd edition');
    expect(text).toContain('replaycon.in');
  });
});
