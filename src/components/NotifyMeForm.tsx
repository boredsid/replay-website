// src/components/NotifyMeForm.tsx
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
      <div className="px-6 py-12 max-w-md mx-auto text-center">
        <h2 className="text-2xl font-bold mb-2">Got it.</h2>
        <p className="text-gray-700">We'll be in touch.</p>
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
    <div className="px-6 py-12 max-w-md mx-auto">
      <h1 className="text-3xl font-bold mb-2">{heading}</h1>
      <p className="text-gray-700 mb-6">{body}</p>
      <form onSubmit={onSubmit} className="space-y-4">
        <div>
          <label htmlFor="phone" className="block text-sm font-medium mb-1">Phone</label>
          <input
            id="phone"
            type="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            className="w-full border border-[#F0E6D8] rounded px-3 py-2"
            placeholder="9876543210"
            autoComplete="tel"
          />
          {error && <p className="text-sm text-red-700 mt-1">{error}</p>}
        </div>
        <button
          type="submit"
          disabled={submitting}
          className="bg-[var(--color-replay-orange)] text-white px-6 py-2 rounded font-bold disabled:opacity-50"
        >
          {submitting ? 'Sending…' : 'Notify me'}
        </button>
      </form>
    </div>
  );
}

export default NotifyMeForm;
