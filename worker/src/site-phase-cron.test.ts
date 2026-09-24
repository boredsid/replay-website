import { beforeEach, describe, expect, it, vi } from 'vitest';

const getCurrentEdition = vi.fn();
vi.mock('./editions', () => ({ getCurrentEdition: (...args: unknown[]) => getCurrentEdition(...args) }));

const { phaseBoundary, rebuildOnPhaseBoundary, PHASE_CRON } = await import('./site-phase-cron');

const REPLAY_3 = { slug: 'replay-3', start_date: '2026-09-12', end_date: '2026-09-13' };
const env = { CLOUDFLARE_PAGES_DEPLOY_HOOK: 'https://hook.test/deploy' } as any;

function auditClient(error: unknown = null) {
  const insert = vi.fn(async () => ({ error }));
  return { sb: { from: vi.fn(() => ({ insert })) } as any, insert };
}

beforeEach(() => {
  vi.restoreAllMocks();
  getCurrentEdition.mockReset();
});

describe('phaseBoundary', () => {
  it('turns live on the first event day', () => {
    expect(phaseBoundary(REPLAY_3, '2026-09-12')).toBe('live');
  });

  it('turns wrapped the morning after the last event day', () => {
    expect(phaseBoundary(REPLAY_3, '2026-09-14')).toBe('wrapped');
  });

  it('leaves every other day alone, including the last event day itself', () => {
    for (const day of ['2026-09-11', '2026-09-13', '2026-09-15', '2026-10-14']) {
      expect(phaseBoundary(REPLAY_3, day)).toBeNull();
    }
  });

  it('carries the day after across a month end', () => {
    expect(phaseBoundary({ start_date: '2026-09-29', end_date: '2026-09-30' }, '2026-10-01')).toBe('wrapped');
    expect(phaseBoundary({ start_date: '2026-12-30', end_date: '2026-12-31' }, '2027-01-01')).toBe('wrapped');
  });

  it('works for a one-day edition', () => {
    const mini = { start_date: '2026-01-31', end_date: '2026-01-31' };
    expect(phaseBoundary(mini, '2026-01-31')).toBe('live');
    expect(phaseBoundary(mini, '2026-02-01')).toBe('wrapped');
  });
});

describe('rebuildOnPhaseBoundary', () => {
  // The cron fires at 21:30 UTC, which is already 03:00 the next day in Bengaluru.
  const CRON_AFTER_REPLAY_3 = new Date('2026-09-13T21:30:00Z');
  const CRON_MID_OCTOBER = new Date('2026-10-14T21:30:00Z');

  it('is scheduled for 03:00 in Bengaluru', () => {
    expect(PHASE_CRON).toBe('30 21 * * *');
  });

  it('rebuilds the site the night REPLAY 3 ends, and records who did it', async () => {
    getCurrentEdition.mockResolvedValue(REPLAY_3);
    const fetchMock = vi.fn(async () => new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const { sb, insert } = auditClient();

    const result = await rebuildOnPhaseBoundary(env, sb, CRON_AFTER_REPLAY_3);

    expect(result).toEqual({ phase: 'wrapped', rebuilt: true });
    expect(fetchMock).toHaveBeenCalledWith('https://hook.test/deploy', { method: 'POST' });
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({
      actor_email: 'system:phase-cron',
      action: 'site.rebuild',
      diff: { reason: 'phase', phase: 'wrapped', edition: 'replay-3' },
    }));
  });

  it('does nothing on an ordinary night', async () => {
    getCurrentEdition.mockResolvedValue(REPLAY_3);
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const result = await rebuildOnPhaseBoundary(env, auditClient().sb, CRON_MID_OCTOBER);
    expect(result).toEqual({ phase: null, rebuilt: false });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('does nothing when no edition is current', async () => {
    getCurrentEdition.mockResolvedValue(null);
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    expect(await rebuildOnPhaseBoundary(env, auditClient().sb, CRON_AFTER_REPLAY_3)).toEqual({ phase: null, rebuilt: false });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('logs a refused hook without throwing, and writes no audit row', async () => {
    getCurrentEdition.mockResolvedValue(REPLAY_3);
    vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 500 })));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { sb, insert } = auditClient();
    expect(await rebuildOnPhaseBoundary(env, sb, CRON_AFTER_REPLAY_3)).toEqual({ phase: 'wrapped', rebuilt: false });
    expect(insert).not.toHaveBeenCalled();
  });

  it('survives the hook being unreachable', async () => {
    getCurrentEdition.mockResolvedValue(REPLAY_3);
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('network down'); }));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(await rebuildOnPhaseBoundary(env, auditClient().sb, CRON_AFTER_REPLAY_3)).toEqual({ phase: 'wrapped', rebuilt: false });
  });

  it('still reports the rebuild when only the audit row fails', async () => {
    getCurrentEdition.mockResolvedValue(REPLAY_3);
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 200 })));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { sb } = auditClient({ message: 'down' });
    expect(await rebuildOnPhaseBoundary(env, sb, CRON_AFTER_REPLAY_3)).toEqual({ phase: 'wrapped', rebuilt: true });
  });
});
