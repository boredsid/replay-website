import { useEffect, useState } from 'react';
import { claimPartnerInvitePayment, getPartnerInvite, submitPartnerInvite } from '../lib/worker';
import type { ApiPartnerInvite, Day } from '../lib/types';
import { weekdayName } from '../lib/edition-format';
import { UpiBottomSheet } from './UpiBottomSheet';

export interface PartnerInviteFormProps {
  upiId: string;
  /** Overridden in tests. In the browser the token comes from `?t=`. */
  token?: string;
}

function tokenFromLocation(): string {
  if (typeof window === 'undefined') return '';
  return new URLSearchParams(window.location.search).get('t')?.trim() ?? '';
}

function money(value: number): string {
  return `₹${value.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
}

function sanitizePhone(value: string): string {
  const digits = value.replace(/\D/g, '');
  return digits.length >= 10 ? digits.slice(-10) : '';
}

function loadErrorMessage(error: any): string {
  const apiError = error?.body?.error;
  if (apiError === 'invite_expired') return 'This partner link has expired. Ask the REPLAY team for a fresh one.';
  if (apiError === 'invite_not_found') return "We couldn't find this partner link. Check you copied the whole thing, or ask the REPLAY team to resend it.";
  if (apiError === 'rate_limited') return 'Too many attempts. Please wait a minute and reload.';
  return "We couldn't load this partner link. Please try again in a moment.";
}

function submitErrorMessage(error: any): string {
  const apiError = error?.body?.error;
  if (apiError === 'invite_cancelled') return 'This partner link has been withdrawn. Please contact the REPLAY team.';
  if (apiError === 'invite_already_confirmed') return 'This partnership is already confirmed — nothing more to do.';
  if (apiError === 'invite_expired') return 'This partner link has expired. Ask the REPLAY team for a fresh one.';
  if (apiError === 'rate_limited') return 'Too many attempts. Please wait a minute and try again.';
  return 'Something went wrong. Please check your details and retry.';
}

export function PartnerInviteForm({ upiId, token: tokenProp }: PartnerInviteFormProps) {
  const [token] = useState(() => tokenProp ?? tokenFromLocation());
  const [invite, setInvite] = useState<ApiPartnerInvite | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [contactName, setContactName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [websiteUrl, setWebsiteUrl] = useState('');
  const [gstin, setGstin] = useState('');
  const [details, setDetails] = useState('');
  const [day, setDay] = useState<Day>('day1');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [upiOpen, setUpiOpen] = useState(false);
  const [paymentSubmitting, setPaymentSubmitting] = useState(false);
  const [paymentError, setPaymentError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) {
      setLoadError("This partner link is missing its code. Ask the REPLAY team to resend it.");
      return;
    }
    let live = true;
    getPartnerInvite(token)
      .then(({ invite: loaded }) => {
        if (!live) return;
        setInvite(loaded);
        setContactName(loaded.contact_name ?? '');
        setPhone(loaded.phone ?? '');
        setEmail(loaded.email ?? '');
        setWebsiteUrl(loaded.website_url ?? '');
        setGstin(loaded.gstin ?? '');
        setDetails(loaded.details ?? '');
        if (loaded.days[0]) setDay(loaded.days[0]);
      })
      .catch((caught) => { if (live) setLoadError(loadErrorMessage(caught)); });
    return () => { live = false; };
  }, [token]);

  async function submit(event: React.SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!invite) return;
    setError(null);
    const cleanPhone = sanitizePhone(phone);
    if (!contactName.trim()) return setError('Contact name is required.');
    if (!cleanPhone) return setError('Enter a 10-digit phone number.');
    if (!email.trim()) return setError('Email is required.');
    if (!details.trim()) return setError('Tell us what you plan to bring or run.');

    setSubmitting(true);
    try {
      const result = await submitPartnerInvite(token, {
        contact_name: contactName.trim(),
        phone: cleanPhone,
        email: email.trim(),
        website_url: websiteUrl.trim() || null,
        gstin: gstin.trim() || null,
        details: details.trim(),
        ...(invite.days_rule === 'single' ? { day } : {}),
      });
      setInvite(result.invite);
      if (result.invite.payment_required) {
        setPaymentError(null);
        setUpiOpen(true);
      }
    } catch (caught) {
      setError(submitErrorMessage(caught));
    } finally {
      setSubmitting(false);
    }
  }

  async function onPaymentClaimed() {
    setPaymentSubmitting(true);
    setPaymentError(null);
    try {
      const result = await claimPartnerInvitePayment(token);
      setInvite(result.invite);
      setUpiOpen(false);
    } catch (caught: any) {
      const reference = invite?.payment_reference ?? '';
      setPaymentError(`We couldn't record your payment. Don't pay again — retry this button or contact the REPLAY team with reference ${reference}.`);
    } finally {
      setPaymentSubmitting(false);
    }
  }

  if (loadError) {
    return (
      <div className="card-brutal card-brutal-lg p-8 text-center">
        <span className="pill pill-accent mb-4">Partner link</span>
        <h1 className="text-4xl mb-4">This link isn’t usable.</h1>
        <p className="text-gray-700 text-lg mb-6">{loadError}</p>
        <a href="/contact" className="btn btn-secondary">Contact the team</a>
      </div>
    );
  }

  if (!invite) {
    return <div className="card-brutal card-brutal-lg p-8 text-center" aria-busy="true"><p className="text-lg">Loading your partner details…</p></div>;
  }

  const day1Name = invite.edition ? weekdayName(invite.edition.start_date) : 'Day 1';
  const day2Name = invite.edition ? weekdayName(invite.edition.end_date) : 'Day 2';

  if (invite.stage === 'cancelled') {
    return (
      <div className="card-brutal card-brutal-lg p-8 text-center">
        <span className="pill pill-accent mb-4">Withdrawn</span>
        <h1 className="text-4xl mb-4">This partner link is no longer active.</h1>
        <p className="text-gray-700 text-lg mb-6">If you think that’s a mistake, the REPLAY team can issue a new one.</p>
        <a href="/contact" className="btn btn-secondary">Contact the team</a>
      </div>
    );
  }

  if (invite.stage === 'confirmed') {
    return (
      <div className="card-brutal card-brutal-lg p-8 text-center">
        <span className="pill pill-yellow mb-4">Confirmed</span>
        <h1 className="text-4xl mb-4">{invite.organization_name} is in.</h1>
        <p className="text-gray-700 text-lg mb-6">
          Your {invite.offer_label.toLowerCase()} for {invite.edition?.name ?? 'REPLAY'} is confirmed. Everything you need is in the confirmation email.
        </p>
        <a href="/contact" className="btn btn-secondary">Contact the team</a>
      </div>
    );
  }

  if (invite.stage === 'prospective' && !invite.payment_required) {
    return (
      <div className="card-brutal card-brutal-lg p-8 text-center">
        <span className="pill pill-accent mb-4">Details received</span>
        <h1 className="text-4xl mb-4">Thanks — we have what we need.</h1>
        <p className="text-gray-700 text-lg mb-6">
          There is nothing to pay for this {invite.offer_label.toLowerCase()}. The REPLAY team will email {invite.email} to confirm.
        </p>
        <a href="/contact" className="btn btn-secondary">Contact the team</a>
      </div>
    );
  }

  if (invite.payment_claimed) {
    return (
      <div className="card-brutal card-brutal-lg p-8 text-center">
        <span className="pill pill-accent mb-4">Payment under review</span>
        <h1 className="text-4xl mb-4">Thanks — we’re verifying the payment.</h1>
        <p className="text-gray-700 text-lg mb-6">
          We’ll check {money(invite.total_amount)} against our UPI records and email {invite.email} once your {invite.offer_label.toLowerCase()} is confirmed.
        </p>
        <p className="text-sm text-gray-600 mb-6">Payment reference: {invite.payment_reference}</p>
        <a href="/contact" className="btn btn-secondary">Contact the team</a>
      </div>
    );
  }

  return (
    <div className="card-brutal card-brutal-lg bg-[var(--color-paper)] p-6 md:p-10">
      <div className="mb-8">
        <span className="pill pill-yellow mb-3">Partner confirmation</span>
        <h1 className="text-3xl md:text-4xl mt-3">{invite.organization_name} × {invite.edition?.name ?? 'REPLAY'}</h1>
        <p className="mt-3 text-gray-700">
          {invite.offer_label}
          {invite.edition ? ` · ${invite.edition.date_range} · ${invite.edition.venue}` : ''}
        </p>
        <p className="mt-2 text-gray-700">Fill in your details, pay by UPI, and the REPLAY team confirms once the payment lands.</p>
      </div>

      {invite.stage === 'prospective' && (
        <div className="card-flat mb-6 p-4 text-sm">
          <strong>Your details are saved.</strong> Complete the UPI payment below to finish.
        </div>
      )}

      <form onSubmit={submit} className="space-y-5">
        {invite.days_rule === 'single' && (
          <fieldset>
            <legend className="label-brutal mb-2">Activity day</legend>
            <div className="grid grid-cols-2 gap-3">
              {(['day1', 'day2'] as Day[]).map((value) => (
                <label key={value} className={`btn cursor-pointer text-center ${day === value ? 'btn-secondary' : ''}`}>
                  <input className="sr-only" type="radio" name="invite-day" checked={day === value} onChange={() => setDay(value)} />
                  {value === 'day1' ? day1Name : day2Name}
                </label>
              ))}
            </div>
          </fieldset>
        )}
        {invite.days_rule === 'weekend' && (
          <div className="card-flat p-4 text-sm"><strong>Event days:</strong> full weekend ({day1Name} + {day2Name})</div>
        )}

        <div className="grid gap-4 md:grid-cols-2">
          <Field label="Primary contact">
            <input aria-label="Primary contact" value={contactName} maxLength={120} onChange={(event) => setContactName(event.target.value)} className="input-brutal w-full" />
          </Field>
          <Field label="Phone">
            <input aria-label="Partner phone" inputMode="tel" autoComplete="tel" value={phone} onChange={(event) => setPhone(event.target.value)} className="input-brutal w-full" />
          </Field>
          <Field label="Email">
            <input aria-label="Partner email" type="email" autoComplete="email" value={email} maxLength={254} onChange={(event) => setEmail(event.target.value)} className="input-brutal w-full" />
          </Field>
          <Field label="Website or social link (optional)">
            <input aria-label="Website or social link" type="url" placeholder="https://" value={websiteUrl} maxLength={500} onChange={(event) => setWebsiteUrl(event.target.value)} className="input-brutal w-full" />
          </Field>
          <Field label="GSTIN (optional)">
            <input aria-label="GSTIN" value={gstin} maxLength={30} onChange={(event) => setGstin(event.target.value.toUpperCase())} className="input-brutal w-full" />
          </Field>
        </div>

        <Field label={invite.kind === 'community_engagement' ? 'What activity will you run?' : 'What will you display, demonstrate or sell?'}>
          <textarea
            aria-label="Partner activity details"
            value={details}
            maxLength={2000}
            rows={5}
            onChange={(event) => setDetails(event.target.value)}
            className="input-brutal w-full"
          />
        </Field>

        <div className="card-flat space-y-2 p-4">
          <div className="flex justify-between text-sm"><span>{invite.offer_label}</span><span>{money(invite.base_amount)}</span></div>
          <div className="flex justify-between text-sm"><span>GST</span><span>{money(invite.gst_amount)}</span></div>
          <div className="flex justify-between border-t-2 border-[var(--color-ink)] pt-2 text-lg font-bold"><span>You pay</span><span>{money(invite.total_amount)}</span></div>
        </div>

        {error && <p role="alert" className="font-medium text-[var(--color-error)]">{error}</p>}
        <button type="submit" disabled={submitting} className="btn btn-primary btn-block">
          {submitting ? 'Saving…' : invite.payment_required ? `Continue to UPI · ${money(invite.total_amount)}` : 'Send my details'}
        </button>
      </form>

      {upiOpen && (
        <UpiBottomSheet
          amount={invite.total_amount}
          upiId={upiId}
          payeeName="REPLAY Convention"
          transactionRef={invite.payment_reference}
          onPaid={onPaymentClaimed}
          onClose={() => { setUpiOpen(false); setPaymentError(null); }}
          isSubmitting={paymentSubmitting}
          error={paymentError}
        />
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="block"><span className="label-brutal mb-2 block">{label}</span>{children}</label>;
}

export default PartnerInviteForm;
