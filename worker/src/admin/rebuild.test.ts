import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleRebuild } from './rebuild';

const sb = { from: () => ({ insert: async () => ({ error: null }) }) } as any;
const env = { CLOUDFLARE_PAGES_DEPLOY_HOOK: 'https://hook.test/deploy' } as any;

beforeEach(() => vi.restoreAllMocks());

describe('handleRebuild', () => {
  it('fires the deploy hook and returns ok', async () => {
    const fetchMock = vi.fn(async () => new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const res = await handleRebuild(env, sb, 'sid@x.com', 'https://admin.replaycon.in');
    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledWith('https://hook.test/deploy', { method: 'POST' });
  });
});
