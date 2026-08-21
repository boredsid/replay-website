import { describe, expect, it } from 'vitest';
import { handleAnnouncementCreate, handleAnnouncementPatch } from './announcements';

const ORIGIN = 'https://admin.replaycon.in';
const VALID = {
  edition_id: 'edition-3',
  title: 'Room change',
  body: 'The tournament has moved to Room B.',
  severity: 'urgent',
  audience: 'day1',
  starts_at: '2026-09-12T04:30:00.000Z',
  ends_at: '2026-09-12T07:30:00.000Z',
  is_published: true,
};

describe('announcement admin handlers', () => {
  it('creates a scheduled notice and writes an audit row', async () => {
    let inserted: any;
    let audit: any;
    const sb: any = {
      from: (table: string) => {
        if (table === 'editions') return {
          select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { id: 'edition-3' }, error: null }) }) }),
        };
        if (table === 'announcements') return {
          insert: (row: any) => {
            inserted = row;
            return { select: () => ({ single: async () => ({ data: { id: 'notice-1', ...row }, error: null }) }) };
          },
        };
        if (table === 'admin_audit_log') return { insert: async (row: any) => { audit = row; return { error: null }; } };
        throw new Error(`unexpected table ${table}`);
      },
    };
    const req = new Request('https://x/api/admin/announcements', { method: 'POST', body: JSON.stringify(VALID) });
    const res = await handleAnnouncementCreate(req, sb, 'sid@example.com', ORIGIN);

    expect(res.status).toBe(200);
    expect(inserted).toMatchObject({ severity: 'urgent', audience: 'day1', is_published: true });
    expect(audit.action).toBe('announcement.create');
    expect(audit.target_table).toBe('announcements');
  });

  it('rejects an end time that does not follow the start time', async () => {
    const req = new Request('https://x/api/admin/announcements', {
      method: 'POST',
      body: JSON.stringify({ ...VALID, ends_at: VALID.starts_at }),
    });
    const res = await handleAnnouncementCreate(req, {} as any, 'sid@example.com', ORIGIN);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'invalid_delivery_window' });
  });

  it('updates severity and records the change', async () => {
    const before = { id: 'notice-1', ...VALID, severity: 'info' };
    let audit: any;
    const sb: any = {
      from: (table: string) => {
        if (table === 'announcements') return {
          select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: before, error: null }) }) }),
          update: (row: any) => ({ eq: () => ({ select: () => ({ single: async () => ({ data: { id: 'notice-1', ...row }, error: null }) }) }) }),
        };
        if (table === 'editions') return {
          select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { id: 'edition-3' }, error: null }) }) }),
        };
        if (table === 'admin_audit_log') return { insert: async (row: any) => { audit = row; return { error: null }; } };
        throw new Error(`unexpected table ${table}`);
      },
    };
    const req = new Request('https://x/api/admin/announcements/notice-1', { method: 'PATCH', body: JSON.stringify({ severity: 'incident' }) });
    const res = await handleAnnouncementPatch(req, sb, 'notice-1', 'sid@example.com', ORIGIN);

    expect(res.status).toBe(200);
    expect(audit.action).toBe('announcement.update');
    expect(audit.diff.severity).toEqual({ old: 'info', new: 'incident' });
  });

  it('rejects unsupported audiences', async () => {
    const req = new Request('https://x/api/admin/announcements', {
      method: 'POST',
      body: JSON.stringify({ ...VALID, audience: 'vip' }),
    });
    const res = await handleAnnouncementCreate(req, {} as any, 'sid@example.com', ORIGIN);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'invalid_audience' });
  });
});
