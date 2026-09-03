import { useState } from 'react';
import type { Device } from '../lib/device';
import { disablePush, enablePush, permissionState, type PushState } from '../lib/push';

interface Props {
  device: Device;
  push: PushState;
  onChange: (state: PushState) => void;
}

/**
 * The permanent way in and out of notifications.
 *
 * Until this existed the only offers were the first-run wizard and the waitlist
 * prompt — both one-off, and both easy to miss. Someone who tapped "No thanks"
 * once, or whose phone quietly lost its subscription, had no route back at all:
 * the app believed they were subscribed and never mentioned it again.
 *
 * It lives on the ID screen because that is the one tab that is already about
 * this device rather than about the event.
 */
export default function NotificationSettings({ device, push, onChange }: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const permission = permissionState();

  // No key means the server has push switched off entirely, so there is nothing
  // to offer. A browser that cannot do it is told why, below, rather than shown
  // a button that could not work.
  if (!push.vapidPublicKey) return null;

  async function turnOn() {
    setBusy(true);
    setError(null);
    const result = await enablePush(device, push.vapidPublicKey!);
    setBusy(false);
    if (result.ok) { onChange({ ...push, subscribed: true }); return; }
    setError(
      result.reason === 'denied'
        ? 'Notifications are blocked for REPLAY. You can turn them back on in your device settings.'
        : 'That did not work. Try again in a moment.',
    );
  }

  async function turnOff() {
    setBusy(true);
    setError(null);
    const ok = await disablePush(device);
    setBusy(false);
    if (ok) { onChange({ ...push, subscribed: false }); return; }
    setError('That did not work. Try again in a moment.');
  }

  return (
    <section className="screen-section" aria-label="Notifications">
      <span className="eyebrow">Notifications</span>
      <h2>{push.subscribed ? 'You will be told when it matters.' : 'Want telling when it matters?'}</h2>
      <p>
        A seat opening up on a waitlist, a session you booked or starred
        starting shortly, and anything urgent from the organisers. Nothing
        else.
      </p>

      {permission === 'unsupported' && (
        <p className="wizard__aside">
          This browser cannot show notifications. Adding REPLAY to your home
          screen and opening it from there enables them.
        </p>
      )}
      {permission === 'denied' && (
        <p className="wizard__aside">
          Notifications are blocked for REPLAY. Turn them on in your device
          settings, then come back here.
        </p>
      )}

      {push.subscribed ? (
        <button type="button" className="text-button" disabled={busy} onClick={() => void turnOff()}>
          {busy ? 'Just a moment…' : 'Turn off notifications'}
        </button>
      ) : permission !== 'unsupported' && permission !== 'denied' && (
        <button type="button" className="button" disabled={busy} onClick={() => void turnOn()}>
          {busy ? 'Just a moment…' : 'Turn on notifications'}
        </button>
      )}

      {error && <p className="pass__error" role="alert">{error}</p>}
    </section>
  );
}
