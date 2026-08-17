import { useState } from 'react';
import { captureLead } from '../lib/worker';
import type { RegistrationStatus } from '../lib/types';

export interface NotifyMeFormProps {
  editionId: string;
  editionName: string;
  status: Exclude<RegistrationStatus, 'open'>;
}

function sanitize(p: string): string {
  const d = p.replace(/\D/g, '');
  return d.length >= 10 ? d.slice(-10) : '';
}

export function NotifyMeForm({ editionId }: NotifyMeFormProps) {
  const [phone, setPhone] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (submitted) {
    return (
      <div className="text-center py-6">
        <h2 className="text-2xl mb-2 font-bold" style={{ fontFamily: 'var(--font-heading)' }}>Got it.</h2>
        <p className="text-gray-700">We'll WhatsApp you when registration opens.</p>
      </div>
    );
  }

  async function onSubmit(e: React.SubmitEvent<HTMLFormElement>) {
    e.preventDefault();
    const sanitized = sanitize(phone);
    if (!sanitized) { setError('Enter a 10-digit phone number'); return; }
    setError(null);
    setSubmitting(true);
    const captured = await captureLead(sanitized, editionId, 'phone_entered');
    setSubmitting(false);
    if (!captured) {
      setError('We could not save your number. Please try again.');
      return;
    }
    setSubmitted(true);
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div>
        <label htmlFor="phone" className="label-brutal">Phone</label>
        <input
          id="phone"
          type="tel"
          inputMode="numeric"
          required
          maxLength={20}
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          className="input-brutal"
          placeholder="9876543210"
          autoComplete="tel"
        />
        {error && <p role="alert" className="text-sm text-[var(--color-error)] mt-2">{error}</p>}
      </div>
      <button type="submit" disabled={submitting} className="btn btn-primary btn-block">
        {submitting ? 'Sending…' : 'Notify me'}
      </button>
    </form>
  );
}

export default NotifyMeForm;
