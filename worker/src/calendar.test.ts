import { describe, expect, it } from 'vitest';
import { buildGoogleCalendarUrl, buildWhatsAppShareUrl } from './calendar';

const edition = {
  slug: 'replay-3',
  name: 'REPLAY',
  start_date: '2026-09-12',
  end_date: '2026-09-13',
  daily_start_time: '10:00:00',
  daily_end_time: '19:00:00',
  venue: 'The Foundry, Bangalore',
};

describe('buildGoogleCalendarUrl', () => {
  it('encodes start and end in UTC ISO basic format', () => {
    const url = buildGoogleCalendarUrl(edition);
    expect(url).toContain('dates=20260912T043000Z%2F20260913T133000Z');
  });
  it('uses the edition times instead of a hard-coded event window', () => {
    const url = buildGoogleCalendarUrl({ ...edition, daily_start_time: '09:15', daily_end_time: '20:30' });
    expect(url).toContain('dates=20260912T034500Z%2F20260913T150000Z');
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
