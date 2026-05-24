import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('./supabase', () => ({ serviceClient: vi.fn() }));

import { serviceClient } from './supabase';
import { handleIcsRequest } from './ics';

function mockEnv() {
  return { SUPABASE_URL: 'x', SUPABASE_SERVICE_KEY: 'x' } as any;
}

function mockSupabaseWithEdition(edition: any) {
  return {
    from: (table: string) => {
      if (table === 'editions') {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                maybeSingle: async () => ({ data: edition, error: null }),
              }),
            }),
          }),
        };
      }
      throw new Error('unexpected table ' + table);
    },
  };
}

const replay3 = {
  id: 'e1',
  slug: 'replay-3',
  name: 'REPLAY',
  start_date: '2026-09-12',
  end_date: '2026-09-13',
  venue: 'The Foundry, Bangalore',
};

describe('handleIcsRequest', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 200 with text/calendar MIME for a known slug', async () => {
    (serviceClient as any).mockReturnValue(mockSupabaseWithEdition(replay3));
    const req = new Request('https://api.replaycon.in/api/ics/replay-3.ics');
    const res = await handleIcsRequest(req, mockEnv());
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/calendar');
  });

  it('returns a body with VEVENT and ordinal-aware summary', async () => {
    (serviceClient as any).mockReturnValue(mockSupabaseWithEdition(replay3));
    const req = new Request('https://api.replaycon.in/api/ics/replay-3.ics');
    const res = await handleIcsRequest(req, mockEnv());
    const body = await res.text();
    expect(body).toContain('BEGIN:VCALENDAR');
    expect(body).toContain('BEGIN:VEVENT');
    expect(body).toContain('SUMMARY:REPLAY 3rd edition');
    expect(body).toContain('DTSTART:20260912T043000Z');
    expect(body).toContain('DTEND:20260913T133000Z');
    expect(body).toContain('LOCATION:The Foundry\\, Bangalore');
    expect(body).toContain('END:VCALENDAR');
  });

  it('returns 404 for an unknown slug', async () => {
    (serviceClient as any).mockReturnValue(mockSupabaseWithEdition(null));
    const req = new Request('https://api.replaycon.in/api/ics/replay-99.ics');
    const res = await handleIcsRequest(req, mockEnv());
    expect(res.status).toBe(404);
  });

  it('sets a 24h public Cache-Control header', async () => {
    (serviceClient as any).mockReturnValue(mockSupabaseWithEdition(replay3));
    const req = new Request('https://api.replaycon.in/api/ics/replay-3.ics');
    const res = await handleIcsRequest(req, mockEnv());
    expect(res.headers.get('cache-control')).toBe('public, max-age=86400');
  });
});
