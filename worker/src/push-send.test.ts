import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('./web-push', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./web-push')>()),
  sendPush: vi.fn(),
}));

import { notifyAttendees, pushConfig } from './push-send';
import { sendPush } from './web-push';
import type { Env } from './index';

const send = sendPush as unknown as ReturnType<typeof vi.fn>;

const ENV = {
  VAPID_PUBLIC_KEY: 'public-key',
  VAPID_PRIVATE_KEY: 'private-key',
  VAPID_SUBJECT: 'mailto:hello@replaycon.in',
} as unknown as Env;

const NOTE = { title: 'A seat opened', body: 'Werewolf, 2pm' };

function client(rows: Array<Record<string, unknown>>, onUpdate?: (patch: Record<string, unknown>) => void) {
  return {
    from: () => ({
      select: () => ({ in: () => ({ is: () => ({ eq: async () => ({ data: rows, error: null }) }) }) }),
      update: (patch: Record<string, unknown>) => {
        onUpdate?.(patch);
        // Successes and prunes are bulk-updated with .in; a lone failure count
        // still goes through .eq.
        return {
          eq: async () => ({ error: null }),
          in: async () => ({ error: null }),
        };
      },
    }),
  } as never;
}

const SUB = { id: 's1', endpoint: 'https://push.example/a', p256dh: 'pub', auth: 'auth', failure_count: 0 };

beforeEach(() => { send.mockReset(); });

describe('pushConfig', () => {
  it('is null without the secret, which disables sending rather than crashing', () => {
    expect(pushConfig({ VAPID_PUBLIC_KEY: 'k', VAPID_SUBJECT: 's' } as unknown as Env)).toBeNull();
  });

  it('is present once the secret is set', () => {
    expect(pushConfig(ENV)).toMatchObject({ publicKey: 'public-key', subject: 'mailto:hello@replaycon.in' });
  });
});

describe('notifyAttendees', () => {
  it('sends nothing at all when push is not configured', async () => {
    const result = await notifyAttendees(
      { VAPID_PUBLIC_KEY: 'k' } as unknown as Env, client([SUB]), ['a1'], 'waitlist', NOTE,
    );
    expect(result).toEqual({ sent: 0, pruned: 0, failed: 0, skipped: 0 });
    expect(send).not.toHaveBeenCalled();
  });

  it('sends nothing when nobody is being notified', async () => {
    await notifyAttendees(ENV, client([SUB]), [], 'waitlist', NOTE);
    expect(send).not.toHaveBeenCalled();
  });

  it('delivers the notification as the payload', async () => {
    send.mockResolvedValue({ ok: true });
    await notifyAttendees(ENV, client([SUB]), ['a1'], 'waitlist', NOTE);

    expect(send).toHaveBeenCalledTimes(1);
    expect(JSON.parse(send.mock.calls[0][1])).toEqual(NOTE);
  });

  it('records a success and clears the failure count', async () => {
    send.mockResolvedValue({ ok: true });
    const patches: Record<string, unknown>[] = [];
    await notifyAttendees(ENV, client([{ ...SUB, failure_count: 3 }], (p) => patches.push(p)), ['a1'], 'waitlist', NOTE);

    expect(patches[0]).toMatchObject({ failure_count: 0 });
    expect(patches[0].last_success_at).toBeTruthy();
  });

  it('revokes a subscription the push service says is gone', async () => {
    send.mockResolvedValue({ ok: false, gone: true, status: 410 });
    const patches: Record<string, unknown>[] = [];
    const result = await notifyAttendees(ENV, client([SUB], (p) => patches.push(p)), ['a1'], 'waitlist', NOTE);

    expect(result).toMatchObject({ pruned: 1, sent: 0 });
    expect(patches[0].revoked_at).toBeTruthy();
  });

  it('keeps a subscription that merely failed, and counts the failure', async () => {
    send.mockResolvedValue({ ok: false, gone: false, status: 503 });
    const patches: Record<string, unknown>[] = [];
    const result = await notifyAttendees(ENV, client([{ ...SUB, failure_count: 2 }], (p) => patches.push(p)), ['a1'], 'waitlist', NOTE);

    // Losing every subscription during an outage would be worse than the outage.
    expect(result).toMatchObject({ failed: 1, pruned: 0 });
    expect(patches[0]).toEqual({ failure_count: 3 });
  });

  it('keeps going after one subscription fails', async () => {
    send
      .mockResolvedValueOnce({ ok: false, gone: true, status: 410 })
      .mockResolvedValueOnce({ ok: true });
    const result = await notifyAttendees(
      ENV, client([SUB, { ...SUB, id: 's2', endpoint: 'https://push.example/b' }]), ['a1'], 'waitlist', NOTE,
    );

    expect(result).toMatchObject({ sent: 1, pruned: 1 });
  });

  it('returns an empty result rather than throwing when the query fails', async () => {
    const broken = {
      from: () => ({ select: () => ({ in: () => ({ is: () => ({ eq: async () => ({ data: null, error: { message: 'boom' } }) }) }) }) }),
    } as never;
    // Every caller is doing something more important than notifying.
    expect(await notifyAttendees(ENV, broken, ['a1'], 'waitlist', NOTE)).toEqual({ sent: 0, pruned: 0, failed: 0, skipped: 0 });
  });

  it.each([
    ['waitlist', 'wants_waitlist'],
    ['announcements', 'wants_announcements'],
    ['reminders', 'wants_reminders'],
  ])('filters on the %s preference column', async (category, column) => {
    send.mockResolvedValue({ ok: true });
    let filtered = '';
    const sb = {
      from: () => ({
        select: () => ({ in: () => ({ is: () => ({ eq: async (col: string) => { filtered = col; return { data: [], error: null }; } }) }) }),
        update: () => ({ eq: async () => ({ error: null }), in: async () => ({ error: null }) }),
      }),
    } as never;

    await notifyAttendees(ENV, sb, ['a1'], category as 'waitlist', NOTE);

    // Someone who wants their waitlist seat may not want every announcement.
    expect(filtered).toBe(column);
  });
});
