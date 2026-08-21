import { useEffect, useMemo, useState } from 'react';
import { previewPartnerPackage, purchasePartnerPackage } from '../lib/worker';
import type { ApiPartnerPurchaseDetails, Day, EditionRow, PartnerPackageKey } from '../lib/types';
import {
  PARTNER_PACKAGE_LABELS,
  partnerBasePrice,
  partnerGstAmount,
} from '../lib/partner-packages';
import { weekdayName } from '../lib/edition-format';
import { UpiBottomSheet } from './UpiBottomSheet';

export interface PartnerPurchaseFormProps {
  edition: EditionRow;
  upiId: string;
}

const PACKAGE_KEYS: PartnerPackageKey[] = [
  'standard_booth',
  'community_booth',
  'standard_engagement',
  'patron_engagement',
];

function sanitizePhone(value: string): string {
  const digits = value.replace(/\D/g, '');
  return digits.length >= 10 ? digits.slice(-10) : '';
}

function isBooth(packageKey: PartnerPackageKey): boolean {
  return packageKey === 'standard_booth' || packageKey === 'community_booth';
}

function money(value: number): string {
  return `₹${value.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
}

export function PartnerPurchaseForm({ edition, upiId }: PartnerPurchaseFormProps) {
  const [packageKey, setPackageKey] = useState<PartnerPackageKey>('standard_booth');
  const [day, setDay] = useState<Day>('day1');
  const [organizationName, setOrganizationName] = useState('');
  const [contactName, setContactName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [websiteUrl, setWebsiteUrl] = useState('');
  const [gstin, setGstin] = useState('');
  const [details, setDetails] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [upiOpen, setUpiOpen] = useState<{
    amount: number;
    paymentReference: string;
    request: ApiPartnerPurchaseDetails;
  } | null>(null);
  const [paymentSubmitting, setPaymentSubmitting] = useState(false);
  const [paymentError, setPaymentError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    function selectPackage(event: MouseEvent) {
      const target = event.target instanceof Element
        ? event.target.closest<HTMLElement>('[data-partner-package]')
        : null;
      const value = target?.dataset.partnerPackage as PartnerPackageKey | undefined;
      if (value && PACKAGE_KEYS.includes(value)) setPackageKey(value);
    }
    document.addEventListener('click', selectPackage);
    return () => document.removeEventListener('click', selectPackage);
  }, []);

  const booth = isBooth(packageKey);
  const days: Day[] = booth ? ['day1', 'day2'] : [day];
  const base = partnerBasePrice(edition.partner_pricing, packageKey);
  const gst = partnerGstAmount(base, edition.partner_pricing.gst_rate);
  const total = base + gst;
  const day1Name = useMemo(() => weekdayName(edition.start_date), [edition.start_date]);
  const day2Name = useMemo(() => weekdayName(edition.end_date), [edition.end_date]);

  async function submit(event: React.SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    const cleanPhone = sanitizePhone(phone);
    if (!organizationName.trim()) return setError('Organisation name is required.');
    if (!contactName.trim()) return setError('Contact name is required.');
    if (!cleanPhone) return setError('Enter a 10-digit phone number.');
    if (!email.trim()) return setError('Email is required.');
    if (!details.trim()) return setError('Tell us what you plan to bring or run.');

    setSubmitting(true);
    try {
      const request: ApiPartnerPurchaseDetails = {
        edition_id: edition.id,
        organization_name: organizationName.trim(),
        contact_name: contactName.trim(),
        phone: cleanPhone,
        email: email.trim(),
        website_url: websiteUrl.trim() || null,
        gstin: gstin.trim() || null,
        package_key: packageKey,
        days,
        details: details.trim(),
      };
      const result = await previewPartnerPackage(request);
      if (result.payment_required) {
        setPaymentError(null);
        setUpiOpen({
          amount: result.final_amount,
          paymentReference: result.payment_reference,
          request,
        });
      } else {
        await purchasePartnerPackage({
          ...request,
          partner_id: result.payment_reference,
          expected_amount: result.final_amount,
        });
        setSuccess(true);
      }
    } catch (caught: any) {
      const apiError = caught?.body?.error;
      if (apiError === 'partner_sales_closed') setError('Online partner purchases are closed for this edition. Please contact the REPLAY team.');
      else if (apiError === 'rate_limited') setError('Too many attempts. Please wait a minute and try again.');
      else setError('Something went wrong. Please check your details and retry.');
    } finally {
      setSubmitting(false);
    }
  }

  async function onPaymentClaimed() {
    if (!upiOpen) return;
    setPaymentSubmitting(true);
    setPaymentError(null);
    try {
      await purchasePartnerPackage({
        ...upiOpen.request,
        partner_id: upiOpen.paymentReference,
        expected_amount: upiOpen.amount,
      });
      setUpiOpen(null);
      setSuccess(true);
    } catch (caught: any) {
      const apiError = caught?.body?.error;
      if (apiError === 'amount_changed') {
        setPaymentError(`The package amount changed before we could record this. Don't pay again—contact the REPLAY team with payment reference ${upiOpen.paymentReference}.`);
      } else if (apiError === 'partner_sales_closed') {
        setPaymentError(`Partner sales closed before we could record this. Don't pay again—contact the REPLAY team with payment reference ${upiOpen.paymentReference}.`);
      } else {
        setPaymentError(`We couldn't record your partner purchase. Don't pay again—retry this button or contact the REPLAY team with payment reference ${upiOpen.paymentReference}.`);
      }
    } finally {
      setPaymentSubmitting(false);
    }
  }

  if (success) {
    return (
      <div className="card-brutal card-brutal-lg p-8 text-center">
        <span className="pill pill-accent mb-4">Payment pending review</span>
        <h3 className="text-4xl mb-4">Your partner request is in.</h3>
        <p className="text-gray-700 text-lg mb-6">
          We’ll verify the payment and email {email} with the confirmed {PARTNER_PACKAGE_LABELS[packageKey].toLowerCase()} details.
        </p>
        <a href="/contact" className="btn btn-secondary">Contact the team</a>
      </div>
    );
  }

  return (
    <div className="card-brutal card-brutal-lg bg-[var(--color-paper)] p-6 md:p-10">
      <div className="mb-8">
        <span className="pill pill-yellow mb-3">Online partner checkout</span>
        <h3 className="text-3xl md:text-4xl mt-3">Choose, pay and send the operating details.</h3>
        <p className="mt-3 text-gray-700">Payment stays pending until the REPLAY team verifies it. Your activity or booth is confirmed by email.</p>
      </div>

      <form onSubmit={submit} className="space-y-5">
        <label className="block">
          <span className="label-brutal mb-2 block">Package</span>
          <select
            aria-label="Partner package"
            value={packageKey}
            onChange={(event) => setPackageKey(event.target.value as PartnerPackageKey)}
            className="input-brutal w-full"
          >
            {PACKAGE_KEYS.map((key) => (
              <option key={key} value={key}>{PARTNER_PACKAGE_LABELS[key]} — {money(edition.partner_pricing[key])} + GST</option>
            ))}
          </select>
        </label>

        {booth ? (
          <div className="card-flat p-4 text-sm"><strong>Event days:</strong> full weekend ({day1Name} + {day2Name})</div>
        ) : (
          <fieldset>
            <legend className="label-brutal mb-2">Activity day</legend>
            <div className="grid grid-cols-2 gap-3">
              {(['day1', 'day2'] as Day[]).map((value) => (
                <label key={value} className={`btn cursor-pointer text-center ${day === value ? 'btn-secondary' : ''}`}>
                  <input className="sr-only" type="radio" name="partner-day" checked={day === value} onChange={() => setDay(value)} />
                  {value === 'day1' ? day1Name : day2Name}
                </label>
              ))}
            </div>
          </fieldset>
        )}

        <div className="grid gap-4 md:grid-cols-2">
          <Field label="Organisation name">
            <input aria-label="Organisation name" value={organizationName} maxLength={160} onChange={(event) => setOrganizationName(event.target.value)} className="input-brutal w-full" />
          </Field>
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

        <Field label={booth ? 'What will you display, demonstrate or sell?' : 'What activity will you run?'}>
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
          <div className="flex justify-between text-sm"><span>Package</span><span>{money(base)}</span></div>
          <div className="flex justify-between text-sm"><span>GST ({edition.partner_pricing.gst_rate * 100}%)</span><span>{money(gst)}</span></div>
          <div className="flex justify-between border-t-2 border-[var(--color-ink)] pt-2 text-lg font-bold"><span>You pay</span><span>{money(total)}</span></div>
        </div>

        {error && <p role="alert" className="font-medium text-[var(--color-error)]">{error}</p>}
        <button type="submit" disabled={submitting} className="btn btn-primary btn-block">
          {submitting ? 'Creating payment…' : `Continue to UPI · ${money(total)}`}
        </button>
      </form>

      {upiOpen && (
        <UpiBottomSheet
          amount={upiOpen.amount}
          upiId={upiId}
          payeeName="REPLAY Convention"
          transactionRef={upiOpen.paymentReference}
          onPaid={onPaymentClaimed}
          onClose={() => { setUpiOpen(null); setPaymentError(null); }}
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

export default PartnerPurchaseForm;
