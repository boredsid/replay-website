import { describe, it, expect, vi, beforeEach } from 'vitest';
import { syncAccessGroup } from './access-group';
import type { Env } from '../index';

const CONFIGURED = {
  CF_API_TOKEN: 'token',
  CF_ACCOUNT_ID: 'acct',
  CF_ACCESS_GROUP_ID: 'grp',
} as unknown as Env;

/**
 * Answers the read on one endpoint kind and 404s the other, captures the write.
 *
 * An id copied from the dashboard could be a rule group or a reusable policy;
 * the sync tries both, so the fixture has to be specific about which exists.
 */
function cloudflare(
  group: Record<string, unknown>,
  options: { writeStatus?: number; kind?: 'groups' | 'policies' } = {},
) {
  const { writeStatus = 200, kind = 'groups' } = options;
  const writes: Array<Record<string, unknown>> = [];
  const urls: string[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    if (init?.method === 'PUT') {
      urls.push(url);
      writes.push(JSON.parse(String(init.body)));
      return new Response('{}', { status: writeStatus });
    }
    if (!url.includes(`/access/${kind}/`)) return new Response('no', { status: 404 });
    return new Response(JSON.stringify({ result: group }), { status: 200 });
  }));
  return { writes, urls };
}

beforeEach(() => { vi.unstubAllGlobals(); });

describe('when it is not set up', () => {
  it('says so rather than failing', async () => {
    // The staff table still works; only the perimeter is by hand.
    expect(await syncAccessGroup({} as Env, ['a@x.com'])).toEqual({
      synced: false, reason: 'not_configured',
    });
  });

  it('needs all three settings, not some of them', async () => {
    const partial = { CF_API_TOKEN: 'token', CF_ACCOUNT_ID: 'acct' } as unknown as Env;
    expect(await syncAccessGroup(partial, ['a@x.com'])).toMatchObject({ synced: false });
  });
});

describe('writing the group', () => {
  it('sets exactly the emails it was given', async () => {
    const { writes } = cloudflare({ name: 'REPLAY Admin', include: [] });
    const result = await syncAccessGroup(CONFIGURED, ['a@x.com', 'b@x.com']);

    expect(result).toEqual({ synced: true, members: 2 });
    expect(writes[0].include).toEqual([
      { email: { email: 'a@x.com' } },
      { email: { email: 'b@x.com' } },
    ]);
  });

  it('keeps the name the group already had', async () => {
    // Inventing one would rename it in the dashboard under somebody's feet.
    const { writes } = cloudflare({ name: 'REPLAY Admin', include: [] });
    await syncAccessGroup(CONFIGURED, ['a@x.com']);
    expect(writes[0].name).toBe('REPLAY Admin');
  });

  it('keeps rules it did not put there', async () => {
    // The reason an existing group is safe to point this at: a domain rule, an
    // IdP group or a service token in the same group must survive the sync.
    const { writes } = cloudflare({
      name: 'REPLAY Admin',
      include: [
        { email_domain: { domain: 'replaycon.in' } },
        { email: { email: 'stale@x.com' } },
        { service_token: { token_id: 'abc' } },
      ],
    });
    await syncAccessGroup(CONFIGURED, ['a@x.com']);

    expect(writes[0].include).toEqual([
      { email_domain: { domain: 'replaycon.in' } },
      { service_token: { token_id: 'abc' } },
      { email: { email: 'a@x.com' } },
    ]);
  });

  it('carries exclude and require through untouched', async () => {
    // Omitting them would delete them, which is a quiet way to widen access.
    const { writes } = cloudflare({
      name: 'REPLAY Admin',
      include: [],
      exclude: [{ email: { email: 'banned@x.com' } }],
      require: [{ geo: { country_code: 'IN' } }],
    });
    await syncAccessGroup(CONFIGURED, ['a@x.com']);

    expect(writes[0].exclude).toEqual([{ email: { email: 'banned@x.com' } }]);
    expect(writes[0].require).toEqual([{ geo: { country_code: 'IN' } }]);
  });

  it('can empty the group when nobody is left', async () => {
    const { writes } = cloudflare({ name: 'REPLAY Admin', include: [{ email: { email: 'gone@x.com' } }] });
    await syncAccessGroup(CONFIGURED, []);
    expect(writes[0].include).toEqual([]);
  });
});

describe('when Cloudflare will not play', () => {
  it('reports a failed read without writing anything', async () => {
    const writes: unknown[] = [];
    vi.stubGlobal('fetch', vi.fn(async (_u: string, init?: RequestInit) => {
      if (init?.method === 'PUT') { writes.push(1); return new Response('{}', { status: 200 }); }
      return new Response('nope', { status: 403 });
    }));
    expect(await syncAccessGroup(CONFIGURED, ['a@x.com'])).toMatchObject({ synced: false, reason: 'failed' });
    // Never write a group you could not read: that is how rules get deleted.
    expect(writes).toHaveLength(0);
  });

  it('reports a failed write', async () => {
    cloudflare({ name: 'REPLAY Admin', include: [] }, { writeStatus: 500 });
    expect(await syncAccessGroup(CONFIGURED, ['a@x.com'])).toMatchObject({ synced: false, reason: 'failed' });
  });

  it('never throws, so a staff change is never undone by a network blip', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('socket hang up'); }));
    const result = await syncAccessGroup(CONFIGURED, ['a@x.com']);
    expect(result).toMatchObject({ synced: false, reason: 'failed' });
  });
});


describe('whichever object the id turns out to be', () => {
  it('falls back to a reusable policy when it is not a rule group', async () => {
    // The dashboard puts rule groups and reusable policies on one screen under
    // the same /policies/ URL, so an id copied from there could be either and
    // there is no way to tell by looking.
    const { writes, urls } = cloudflare(
      { name: 'REPLAY Admins', decision: 'allow', include: [] },
      { kind: 'policies' },
    );
    const result = await syncAccessGroup(CONFIGURED, ['a@x.com']);

    expect(result).toEqual({ synced: true, members: 1 });
    expect(urls[0]).toContain('/access/policies/');
  });

  it("keeps a policy's decision, which would otherwise stop being an allow", async () => {
    const { writes } = cloudflare(
      { name: 'REPLAY Admins', decision: 'allow', include: [] },
      { kind: 'policies' },
    );
    await syncAccessGroup(CONFIGURED, ['a@x.com']);
    expect(writes[0].decision).toBe('allow');
  });

  it('does not send back fields the server owns', async () => {
    const { writes } = cloudflare({
      name: 'REPLAY Admin', include: [],
      id: 'abc', uid: 'abc', created_at: 'then', updated_at: 'then',
    });
    await syncAccessGroup(CONFIGURED, ['a@x.com']);
    for (const field of ['id', 'uid', 'created_at', 'updated_at']) {
      expect(writes[0]).not.toHaveProperty(field);
    }
  });

  it('says what it tried when the id is neither', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('no', { status: 404 })));
    const result = await syncAccessGroup(CONFIGURED, ['a@x.com']);
    expect(result).toMatchObject({ synced: false, reason: 'failed' });
    expect((result as { detail: string }).detail).toContain('groups 404');
    expect((result as { detail: string }).detail).toContain('policies 404');
  });
});
