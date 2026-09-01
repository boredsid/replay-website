import { useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import {
  clearDevice,
  isCompleteCode,
  normalizeCode,
  pairDevice,
  type Device,
} from '../lib/device';
import { API_BASE } from '../lib/api';

interface Props {
  device: Device | null;
  onPaired: (device: Device) => void;
  onUnpaired: () => void;
}

const MESSAGES: Record<string, string> = {
  malformed: 'That code is eight characters. Check it and try again.',
  rejected: 'That code did not work. Codes last three minutes — ask the desk for a fresh one.',
  offline: 'No connection. Try again in a moment.',
  unavailable: 'We could not reach the event right now. Try again shortly.',
};

/**
 * The attendee's pass, or the way to get one.
 *
 * The QR is rendered here rather than fetched, so it still works when the venue
 * network does not — which is exactly when someone is standing at the library
 * counter wanting to borrow a game.
 */
export default function Pass({ device, onPaired, onUnpaired }: Props) {
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const result = await pairDevice(API_BASE, code);
      if (result.ok) {
        setCode('');
        onPaired(result.device);
      } else {
        setError(MESSAGES[result.reason]);
      }
    } finally {
      setBusy(false);
    }
  }

  if (device) {
    return (
      <section className="screen-section pass" aria-labelledby="pass-heading">
        <span className="eyebrow">Your pass</span>
        <h2 id="pass-heading">{device.display_name}</h2>
        <div className="pass__code">
          <QRCodeSVG
            value={device.qr_token}
            size={200}
            level="M"
            marginSize={2}
            title={`REPLAY pass for ${device.display_name}`}
          />
        </div>
        <p className="pass__hint">
          Show this at the game library. It only means anything to a member of
          staff scanning it.
        </p>
        <button
          type="button"
          className="text-button"
          onClick={() => { clearDevice(); onUnpaired(); }}
        >
          Remove this pass from this device
        </button>
      </section>
    );
  }

  return (
    <section className="screen-section pass" aria-labelledby="pair-heading">
      <span className="eyebrow">Not set up yet</span>
      <h2 id="pair-heading">Sign up for sessions</h2>
      <p>
        Check in at the desk and ask for your app code. Everything else here —
        the schedule, your saved items, the map — works without it.
      </p>
      <form className="pass__form" onSubmit={submit}>
        <label htmlFor="pair-code">Your eight-character code</label>
        <input
          id="pair-code"
          value={code}
          onChange={(e) => setCode(normalizeCode(e.target.value))}
          placeholder="A1B2C3D4"
          autoComplete="one-time-code"
          autoCapitalize="characters"
          spellCheck={false}
          maxLength={8}
          aria-describedby={error ? 'pair-error' : undefined}
        />
        <button className="button" type="submit" disabled={busy || !isCompleteCode(code)}>
          {busy ? 'Checking…' : 'Set up'}
        </button>
      </form>
      {error && <p className="pass__error" id="pair-error" role="alert">{error}</p>}
    </section>
  );
}
