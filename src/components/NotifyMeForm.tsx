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

function copy(status: NotifyMeFormProps['status'], name: string) {
  if (status === 'sold_out') return { heading: `${name} is sold out`, body: 'Want to hear about the next one? Drop your number.' };
  if (status === 'closed')   return { heading: `${name}: registration closed`, body: 'Drop your number and we\'ll email you about the next REPLAY.' };
  return { heading: `${name}: registration opens soon`, body: 'Drop your number and we\'ll email when it opens.' };
}

export function NotifyMeForm({ editionId, editionName, status }: NotifyMeFormProps) {
  const [phone, setPhone] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { heading, body } = copy(status, editionName);

  if (submitted) {
    return (
      <div className="container-x section text-center max-w-md">
        <div className="card-brutal card-brutal-lg p-10">
          <h2 className="text-3xl mb-3">Got it.</h2>
          <p className="text-gray-700">We'll be in touch.</p>
        </div>
      </div>
    );
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const sanitized = sanitize(phone);
    if (!sanitized) { setError('Enter a 10-digit phone number'); return; }
    setError(null);
    setSubmitting(true);
    await captureLead(sanitized, editionId, 'phone_entered');
    setSubmitting(false);
    setSubmitted(true);
  }

  return (
    <div className="container-x section max-w-xl">
      <span className="pill pill-yellow mb-4">Notify me</span>
      <h1 className="text-4xl md:text-5xl mb-3">{heading}</h1>
      <p className="text-gray-700 mb-8 text-lg">{body}</p>
      <form onSubmit={onSubmit} className="card-brutal p-8 space-y-4">
        <div>
          <label htmlFor="phone" className="label-brutal">Phone</label>
          <input
            id="phone"
            type="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            className="input-brutal"
            placeholder="9876543210"
            autoComplete="tel"
          />
          {error && <p className="text-sm text-[var(--color-error)] mt-2">{error}</p>}
        </div>
        <button type="submit" disabled={submitting} className="btn btn-primary btn-block">
          {submitting ? 'Sending…' : 'Notify me'}
        </button>
      </form>
    </div>
  );
}

export default NotifyMeForm;
