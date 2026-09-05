import { describe, it, expect, vi, beforeEach } from 'vitest';
import { syncAccessGroup } from './access-group';
import type { Env } from '../index';

const CONFIGURED = {
  CF_API_TOKEN: 'token',
  CF_ACCOUNT_ID: 'acct',
  CF_ACCESS_GROUP_ID: 'grp',
} as unknown as Env;

/** Answers the read, captures the write. */
function cloudflare(group: Record<string, unknown>, writeStatus = 200) {
  const writes: Array<Record<string, unknown>> = [];
  vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
    if (!init || init.method !== 'PUT') {
      return new Response(JSON.stringify({ result: group }), { status: 200 });
    }
    writes.push(JSON.parse(String(init.body)));
    return new Response('{}', { status: writeStatus });
  }));
  return writes;
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
    const writes = cloudflare({ name: 'REPLAY Admin', include: [] });
    const result = await syncAccessGroup(CONFIGURED, ['a@x.com', 'b@x.com']);

    expect(result).toEqual({ synced: true, members: 2 });
    expect(writes[0].include).toEqual([
      { email: { email: 'a@x.com' } },
      { email: { email: 'b@x.com' } },
    ]);
  });

  it('keeps the name the group already had', async () => {
    // Inventing one would rename it in the dashboard under somebody's feet.
    const writes = cloudflare({ name: 'REPLAY Admin', include: [] });
    await syncAccessGroup(CONFIGURED, ['a@x.com']);
    expect(writes[0].name).toBe('REPLAY Admin');
  });

  it('keeps rules it did not put there', async () => {
    // The reason an existing group is safe to point this at: a domain rule, an
    // IdP group or a service token in the same group must survive the sync.
    const writes = cloudflare({
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
    const writes = cloudflare({
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
    const writes = cloudflare({ name: 'REPLAY Admin', include: [{ email: { email: 'gone@x.com' } }] });
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
    cloudflare({ name: 'REPLAY Admin', include: [] }, 500);
    expect(await syncAccessGroup(CONFIGURED, ['a@x.com'])).toMatchObject({ synced: false, reason: 'failed' });
  });

  it('never throws, so a staff change is never undone by a network blip', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('socket hang up'); }));
    const result = await syncAccessGroup(CONFIGURED, ['a@x.com']);
    expect(result).toMatchObject({ synced: false, reason: 'failed' });
  });
});
