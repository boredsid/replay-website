import { describe, expect, it } from 'vitest';
import {
  handleSponsorCreate,
  handleSponsorDelete,
  handleSponsorLogoUpload,
  handleSponsorPatch,
} from './sponsors';

const ORIGIN = 'https://admin.replaycon.in';
const VALID = {
  edition_id: 'edition-3',
  name: 'Board Game Company',
  tier: 'gold',
  logo_url: 'https://qvkynwlmzeybdiapbcsy.supabase.co/storage/v1/object/public/sponsor-logos/edition-3/a.png',
  logo_path: 'edition-3/a.png',
  website_url: 'https://boardgamecompany.in',
  display_order: 2,
};

/** Minimal stand-in for the service-role client, storage included. */
function fakeClient(options: {
  sponsor?: any;
  removed?: string[][];
  onInsert?: (row: any) => void;
  onUpdate?: (row: any) => void;
  onAudit?: (row: any) => void;
  onDelete?: () => void;
}) {
  const removed = options.removed ?? [];
  return {
    from: (table: string) => {
      if (table === 'editions') return {
        select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { id: 'edition-3' }, error: null }) }) }),
      };
      if (table === 'sponsors') return {
        select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: options.sponsor ?? null, error: null }) }) }),
        insert: (row: any) => {
          options.onInsert?.(row);
          return { select: () => ({ single: async () => ({ data: { id: 'sponsor-1', ...row }, error: null }) }) };
        },
        update: (row: any) => {
          options.onUpdate?.(row);
          return { eq: () => ({ select: () => ({ single: async () => ({ data: { id: 'sponsor-1', ...row }, error: null }) }) }) };
        },
        delete: () => ({ eq: async () => { options.onDelete?.(); return { error: null }; } }),
      };
      if (table === 'admin_audit_log') return {
        insert: async (row: any) => { options.onAudit?.(row); return { error: null }; },
      };
      throw new Error(`unexpected table ${table}`);
    },
    storage: {
      from: () => ({
        upload: async () => ({ data: { path: 'x' }, error: null }),
        remove: async (paths: string[]) => { removed.push(paths); return { error: null }; },
        getPublicUrl: (path: string) => ({
          data: { publicUrl: `https://qvkynwlmzeybdiapbcsy.supabase.co/storage/v1/object/public/sponsor-logos/${path}` },
        }),
      }),
    },
  } as any;
}

describe('sponsor admin handlers', () => {
  it('creates a sponsor and records the audit row', async () => {
    let inserted: any;
    let audit: any;
    const sb = fakeClient({ onInsert: (row) => { inserted = row; }, onAudit: (row) => { audit = row; } });
    const req = new Request('https://x/api/admin/sponsors', { method: 'POST', body: JSON.stringify(VALID) });

    const res = await handleSponsorCreate(req, sb, 'sid@example.com', ORIGIN);

    expect(res.status).toBe(200);
    expect(inserted).toMatchObject({
      name: 'Board Game Company',
      tier: 'gold',
      website_url: 'https://boardgamecompany.in/',
      logo_path: 'edition-3/a.png',
      display_order: 2,
    });
    expect(audit.action).toBe('sponsor.create');
  });

  it('defaults an unspecified tier and order to the bottom of the wall', async () => {
    let inserted: any;
    const sb = fakeClient({ onInsert: (row) => { inserted = row; } });
    const { tier, display_order, ...rest } = VALID;
    const req = new Request('https://x/api/admin/sponsors', { method: 'POST', body: JSON.stringify(rest) });

    const res = await handleSponsorCreate(req, sb, 'sid@example.com', ORIGIN);

    expect(res.status).toBe(200);
    expect(inserted).toMatchObject({ tier: 'partner', display_order: 0 });
  });

  it('rejects a link that is not an http(s) URL', async () => {
    const req = new Request('https://x/api/admin/sponsors', {
      method: 'POST',
      body: JSON.stringify({ ...VALID, website_url: 'javascript:alert(1)' }),
    });
    const res = await handleSponsorCreate(req, fakeClient({}), 'sid@example.com', ORIGIN);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'invalid_website_url' });
  });

  it('accepts a sponsor with no link at all', async () => {
    let inserted: any;
    const sb = fakeClient({ onInsert: (row) => { inserted = row; } });
    const req = new Request('https://x/api/admin/sponsors', {
      method: 'POST',
      body: JSON.stringify({ ...VALID, website_url: '' }),
    });

    const res = await handleSponsorCreate(req, sb, 'sid@example.com', ORIGIN);

    expect(res.status).toBe(200);
    expect(inserted.website_url).toBeNull();
  });

  it('deletes the artwork a logo swap orphans', async () => {
    const removed: string[][] = [];
    const sb = fakeClient({ sponsor: { id: 'sponsor-1', ...VALID }, removed });
    const req = new Request('https://x/api/admin/sponsors/sponsor-1', {
      method: 'PATCH',
      body: JSON.stringify({
        logo_url: 'https://qvkynwlmzeybdiapbcsy.supabase.co/storage/v1/object/public/sponsor-logos/edition-3/b.png',
        logo_path: 'edition-3/b.png',
      }),
    });

    const res = await handleSponsorPatch(req, sb, 'sponsor-1', 'sid@example.com', ORIGIN);

    expect(res.status).toBe(200);
    expect(removed).toEqual([['edition-3/a.png']]);
  });

  it('keeps the artwork when an edit leaves the logo alone', async () => {
    const removed: string[][] = [];
    const sb = fakeClient({ sponsor: { id: 'sponsor-1', ...VALID }, removed });
    const req = new Request('https://x/api/admin/sponsors/sponsor-1', {
      method: 'PATCH',
      body: JSON.stringify({ display_order: 5 }),
    });

    const res = await handleSponsorPatch(req, sb, 'sponsor-1', 'sid@example.com', ORIGIN);

    expect(res.status).toBe(200);
    expect(removed).toEqual([]);
  });

  it('removes the row and its artwork on delete', async () => {
    const removed: string[][] = [];
    let deleted = false;
    let audit: any;
    const sb = fakeClient({
      sponsor: { id: 'sponsor-1', ...VALID },
      removed,
      onDelete: () => { deleted = true; },
      onAudit: (row) => { audit = row; },
    });

    const res = await handleSponsorDelete(sb, 'sponsor-1', 'sid@example.com', ORIGIN);

    expect(res.status).toBe(200);
    expect(deleted).toBe(true);
    expect(removed).toEqual([['edition-3/a.png']]);
    expect(audit.action).toBe('sponsor.delete');
  });

  it('stores an upload under the edition and answers with its public URL', async () => {
    const sb = fakeClient({});
    const req = new Request('https://x/api/admin/sponsors/logo?edition_id=edition-3', {
      method: 'POST',
      headers: { 'Content-Type': 'image/png' },
      body: new Uint8Array([1, 2, 3]),
    });

    const res = await handleSponsorLogoUpload(req, sb, 'sid@example.com', ORIGIN);
    const body = await res.json() as any;

    expect(res.status).toBe(200);
    expect(body.logo_path).toMatch(/^edition-3\/[0-9a-f-]{36}\.png$/);
    expect(body.logo_url).toContain(`/sponsor-logos/${body.logo_path}`);
  });

  it('refuses a file type the bucket will not hold', async () => {
    const req = new Request('https://x/api/admin/sponsors/logo?edition_id=edition-3', {
      method: 'POST',
      headers: { 'Content-Type': 'application/pdf' },
      body: new Uint8Array([1, 2, 3]),
    });
    const res = await handleSponsorLogoUpload(req, fakeClient({}), 'sid@example.com', ORIGIN);
    expect(res.status).toBe(415);
    expect(await res.json()).toEqual({ error: 'unsupported_image_type' });
  });

  it('refuses an image past the bucket size limit', async () => {
    const req = new Request('https://x/api/admin/sponsors/logo?edition_id=edition-3', {
      method: 'POST',
      headers: { 'Content-Type': 'image/png' },
      body: new Uint8Array(2 * 1024 * 1024 + 1),
    });
    const res = await handleSponsorLogoUpload(req, fakeClient({}), 'sid@example.com', ORIGIN);
    expect(res.status).toBe(413);
    expect(await res.json()).toEqual({ error: 'image_too_large' });
  });
});
