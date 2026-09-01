import { useState } from 'react';
import type { Device } from '../lib/device';
import { enablePush, permissionState, type PushState } from '../lib/push';

interface Props {
  device: Device;
  push: PushState;
  /** The session that just put them on a waitlist, for the copy. */
  sessionTitle: string;
  onDone: (subscribed: boolean) => void;
}

/**
 * Asked once, at the only moment it makes obvious sense.
 *
 * Someone who has just joined a waitlist has a concrete reason to want telling,
 * so the answer is informed. Asking on first load gets a reflexive "no", and a
 * denied permission is permanent — the browser will not ask again, and site
 * settings is somewhere most people never go.
 */
export default function PushPrompt({ device, push, sessionTitle, onDone }: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const permission = permissionState();
  // Nothing to offer if push is unavailable, already denied, or already on.
  if (permission === 'unsupported' || permission === 'denied') return null;
  if (!push.vapidPublicKey || push.subscribed) return null;

  async function turnOn() {
    setBusy(true);
    setError(null);
    const result = await enablePush(device, push.vapidPublicKey!);
    setBusy(false);

    if (result.ok) { onDone(true); return; }
    setError(
      result.reason === 'denied'
        ? 'Notifications are blocked for this site. You can turn them on in your browser settings.'
        : 'That did not work. You will still see your place when you open the app.',
    );
  }

  return (
    <section className="push-prompt" aria-labelledby="push-prompt-heading">
      <span className="eyebrow">You are on the waitlist</span>
      <h3 id="push-prompt-heading">Want telling if a seat opens?</h3>
      <p>
        We will notify you if a place in {sessionTitle} comes free. Otherwise you
        will only find out next time you open the app.
      </p>
      <div className="push-prompt__actions">
        <button type="button" className="button" disabled={busy} onClick={() => void turnOn()}>
          {busy ? 'Just a moment…' : 'Notify me'}
        </button>
        <button type="button" className="text-button" onClick={() => onDone(false)}>
          No thanks
        </button>
      </div>
      {error && <p className="pass__error" role="alert">{error}</p>}
    </section>
  );
}
