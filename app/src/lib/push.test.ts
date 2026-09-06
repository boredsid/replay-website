import { describe, it, expect, vi, afterEach } from 'vitest';
import { reconcilePush, type PushState } from './push';
import type { Device } from './device';

const DEVICE: Device = {
  token: 'tok', qr_token: 'QR', display_name: 'Priya',
  expires_at: new Date(Date.now() + 86_400_000).toISOString(),
};

/** What the server says: subscribed, because some row exists for this attendee. */
const SERVER_SAYS_SUBSCRIBED: PushState = {
  vapidPublicKey: 'BN6D4NKA9S4FLFPB4fBA0MkkZzbZFQBDOHEjPLqSitjabqGYdWJ99EhwKUEMdLF-fhKUUQ3X0JP74Q8PWmv3LBs',
  subscribed: true,
  preferences: { wants_waitlist: true, wants_announcements: true, wants_reminders: true },
};

function subscription(endpoint: string) {
  return { toJSON: () => ({ endpoint, keys: { p256dh: 'p', auth: 'a' } }) };
}

/**
 * A browser with the given subscription, or none at all.
 *
 * `PushManager` and `Notification` only have to exist for the support check, so
 * they are stubbed as bare constructors rather than modelled.
 */
function stubBrowser(existing: ReturnType<typeof subscription> | null, permission: NotificationPermission) {
  const subscribe = vi.fn(async () => subscription('https://web.push.apple.com/fresh'));
  vi.stubGlobal('navigator', {
    serviceWorker: {
      ready: Promise.resolve({
        pushManager: { getSubscription: async () => existing, subscribe },
      }),
    },
  });
  vi.stubGlobal('PushManager', function PushManager() {});
  vi.stubGlobal('Notification', Object.assign(function Notification() {}, { permission }));
  return subscribe;
}

/** Stubs fetch and hands back the body of whatever gets posted to it. */
function capturePost(status = 200): { endpoint?: string; calls: number } {
  const seen: { endpoint?: string; calls: number } = { calls: 0 };
  vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => {
    seen.calls += 1;
    Object.assign(seen, JSON.parse(init.body as string));
    return new Response('{}', { status });
  }));
  return seen;
}

afterEach(() => vi.unstubAllGlobals());

describe('reconcilePush', () => {
  /**
   * The bug this exists to prevent: removing the app from the home screen and
   * adding it again destroys the subscription but leaves the server's row, so
   * the app was told it was subscribed, offered nobody the switch, and every
   * notification went to an endpoint Apple still accepted. Nothing buzzed.
   */
  it('re-subscribes a browser that lost its subscription', async () => {
    const posted = capturePost();
    const subscribe = stubBrowser(null, 'granted');

    const state = await reconcilePush(DEVICE, SERVER_SAYS_SUBSCRIBED);

    expect(subscribe).toHaveBeenCalledOnce();
    expect(state.subscribed).toBe(true);
    expect(posted.endpoint).toBe('https://web.push.apple.com/fresh');
  });

  it('re-registers an existing subscription, repairing a lost or mis-attributed row', async () => {
    const posted = capturePost();
    const subscribe = stubBrowser(subscription('https://web.push.apple.com/existing'), 'granted');

    expect((await reconcilePush(DEVICE, SERVER_SAYS_SUBSCRIBED)).subscribed).toBe(true);
    expect(subscribe).not.toHaveBeenCalled();
    expect(posted.endpoint).toBe('https://web.push.apple.com/existing');
  });

  it('contradicts the server when permission has gone, so the switch is offered again', async () => {
    const posted = capturePost();
    stubBrowser(null, 'default');

    expect((await reconcilePush(DEVICE, SERVER_SAYS_SUBSCRIBED)).subscribed).toBe(false);
    expect(posted.calls).toBe(0);
  });

  it('reports unsubscribed when the server could not record the endpoint', async () => {
    capturePost(500);
    stubBrowser(null, 'granted');

    expect((await reconcilePush(DEVICE, SERVER_SAYS_SUBSCRIBED)).subscribed).toBe(false);
  });

  it('reports unsubscribed rather than throwing when subscribing fails', async () => {
    capturePost();
    vi.stubGlobal('navigator', {
      serviceWorker: {
        ready: Promise.resolve({
          pushManager: {
            getSubscription: async () => null,
            subscribe: async () => { throw new Error('no push service'); },
          },
        }),
      },
    });
    vi.stubGlobal('PushManager', function PushManager() {});
    vi.stubGlobal('Notification', Object.assign(function Notification() {}, { permission: 'granted' }));

    expect((await reconcilePush(DEVICE, SERVER_SAYS_SUBSCRIBED)).subscribed).toBe(false);
  });

  it('leaves preferences and the key alone', async () => {
    capturePost();
    stubBrowser(subscription('https://web.push.apple.com/existing'), 'granted');

    const state = await reconcilePush(DEVICE, SERVER_SAYS_SUBSCRIBED);

    expect(state.preferences).toEqual(SERVER_SAYS_SUBSCRIBED.preferences);
    expect(state.vapidPublicKey).toBe(SERVER_SAYS_SUBSCRIBED.vapidPublicKey);
  });

  it('does nothing when the server has no VAPID key', async () => {
    const posted = capturePost();
    stubBrowser(null, 'granted');

    const state = await reconcilePush(DEVICE, { ...SERVER_SAYS_SUBSCRIBED, vapidPublicKey: null });

    expect(state.subscribed).toBe(false);
    expect(posted.calls).toBe(0);
  });

  it('gives up rather than hanging when the service worker never becomes ready', async () => {
    // `serviceWorker.ready` has no timeout and never rejects. Awaited bare, a
    // registration that never completes leaves this promise pending forever --
    // and because the whole push state waits on it, the notifications switch
    // would never be drawn at all, silently. Answering "off" is recoverable;
    // never answering is not.
    vi.useFakeTimers();
    try {
      const posted = capturePost();
      vi.stubGlobal('navigator', { serviceWorker: { ready: new Promise(() => {}) } });
      vi.stubGlobal('PushManager', function PushManager() {});
      vi.stubGlobal('Notification', Object.assign(function Notification() {}, { permission: 'granted' }));

      const pending = reconcilePush(DEVICE, SERVER_SAYS_SUBSCRIBED);
      await vi.advanceTimersByTimeAsync(5000);
      const state = await pending;

      expect(state.subscribed).toBe(false);
      expect(posted.calls).toBe(0);
      // The rest of the state survives, so the UI can still offer the switch.
      expect(state.vapidPublicKey).toBe(SERVER_SAYS_SUBSCRIBED.vapidPublicKey);
    } finally {
      vi.useRealTimers();
    }
  });
});
