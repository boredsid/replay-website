import { useState } from 'react';
import { isCompleteCode, normalizeCode, pairDevice, type Device } from '../lib/device';
import { API_BASE } from '../lib/api';

interface Props {
  onPaired: (device: Device) => void;
  submitLabel?: string;
}

/**
 * Copy for each way this can fail.
 *
 * Being refused and being offline need different words: one sends someone back
 * to the desk, the other just asks them to wait a moment. Collapsing them into
 * "something went wrong" sends people to queue for no reason.
 */
const MESSAGES: Record<string, string> = {
  malformed: 'That code is eight characters. Check it and try again.',
  rejected: 'That code did not work. Codes last three minutes — ask the desk for a fresh one.',
  offline: 'No connection. Try again in a moment.',
  unavailable: 'We could not reach the event right now. Try again shortly.',
};

export default function PairForm({ onPaired, submitLabel = 'Set up' }: Props) {
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

  return (
    <>
      <form className="pass__form" onSubmit={submit}>
        <label htmlFor="pair-code">Your eight-character code</label>
        <input
          id="pair-code"
          value={code}
          // Folded as they type, so the misreads people actually make off a
          // kiosk screen never become a failed attempt.
          onChange={(e) => setCode(normalizeCode(e.target.value))}
          placeholder="A1B2C3D4"
          autoComplete="one-time-code"
          autoCapitalize="characters"
          spellCheck={false}
          maxLength={8}
          aria-describedby={error ? 'pair-error' : undefined}
        />
        <button className="button" type="submit" disabled={busy || !isCompleteCode(code)}>
          {busy ? 'Checking…' : submitLabel}
        </button>
      </form>
      {error && <p className="pass__error" id="pair-error" role="alert">{error}</p>}
    </>
  );
}
