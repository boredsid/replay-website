// src/components/RegisterForm.tsx
import { useEffect, useRef, useState } from 'react';
import { getEditionSpots, lookupPhone, previewPromoCode, previewRegistration, registerForEdition, captureLead } from '../lib/worker';
import type { ApiEditionSpotsResponse, ApiLookupPhoneResponse, ApiPromoPreviewResponse, ApiRegistrationDetails, EditionRow, Day, PassType } from '../lib/types';
import { promoAppliesToPass, promoDiscountFor, promoErrorMessage, winningDiscount } from '../lib/promo';
import { UpiBottomSheet } from './UpiBottomSheet';
import { SuccessScreen } from './SuccessScreen';
import { weekdayName } from '../lib/edition-format';

export interface RegisterFormProps {
  edition: EditionRow;
  upiId: string;
}

const MAX_TICKET_QUANTITY = 10;

/*
 * `.btn` sits outside a cascade layer in global.css, so it outranks Tailwind's
 * layered utilities however specific they are: its `padding: 14px 28px` and
 * `font-size: 1rem` beat `px-3`, `py-1` and `text-sm`, which left the quantity
 * steppers 74px wide instead of the 44px square `min-w-11` asks for. Padding
 * and font size have to be set inline on these to land. Same cause as the
 * inline style on SuccessScreen's WhatsApp button.
 */
const STEPPER_PADDING = { paddingInline: '0.75rem' } as const;
const COMPACT_BUTTON = { paddingInline: '0.75rem', paddingBlock: '0.25rem', fontSize: '0.875rem' } as const;

function sanitize(p: string): string {
  const d = p.replace(/\D/g, '');
  return d.length >= 10 ? d.slice(-10) : '';
}

function tierLabel(t: string | null) {
  if (t === 'guildmaster') return 'Guildmaster (first ticket free)';
  if (t === 'adventurer') return 'Adventurer (first ticket 100% off, ₹1,000 max discount)';
  if (t === 'initiate') return 'Initiate (20% off the first ticket)';
  return null;
}

function computePrice(edition: EditionRow, passType: PassType, days: Day[]): number {
  if (passType === 'campaign') return edition.pricing.campaign;
  return days.length === 1 ? edition.pricing.oneshot : 0;
}

function computeDiscount(base: number, tier: string | null, cap: number): number {
  if (!tier) return 0;
  if (tier === 'initiate') return Math.round(base * 0.2);
  if (tier === 'adventurer') return Math.min(base, cap);
  if (tier === 'guildmaster') return base;
  return 0;
}

export function RegisterForm({ edition, upiId }: RegisterFormProps) {
  const [spots, setSpots] = useState<ApiEditionSpotsResponse | null>(null);
  const [availabilityError, setAvailabilityError] = useState(false);
  const [phone, setPhone] = useState('');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [passType, setPassType] = useState<PassType>('oneshot');
  const [days, setDays] = useState<Day[]>([]);
  const [quantity, setQuantity] = useState(1);
  const [lookup, setLookup] = useState<ApiLookupPhoneResponse | null>(null);
  const [promoInput, setPromoInput] = useState('');
  const [promo, setPromo] = useState<ApiPromoPreviewResponse | null>(null);
  const [promoBusy, setPromoBusy] = useState(false);
  const [promoError, setPromoError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [upiOpen, setUpiOpen] = useState<{
    amount: number;
    paymentReference: string;
    request: ApiRegistrationDetails;
  } | null>(null);
  const [paymentSubmitting, setPaymentSubmitting] = useState(false);
  const [paymentError, setPaymentError] = useState<string | null>(null);
  const [success, setSuccess] = useState<{ pending: boolean } | null>(null);
  const lookupTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const leadTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Fetch edition spots on mount
  useEffect(() => {
    let cancelled = false;
    getEditionSpots(edition.id)
      .then((r) => { if (!cancelled) { setSpots(r); setAvailabilityError(false); } })
      .catch(() => { if (!cancelled) setAvailabilityError(true); });
    return () => { cancelled = true; };
  }, [edition.id]);

  useEffect(() => {
    const campaignUnavailable = spots?.day1.sold_out || spots?.day2.sold_out;
    if (passType === 'campaign' && campaignUnavailable) {
      setPassType('oneshot');
      setDays([]);
      return;
    }
    if (passType === 'oneshot') {
      const chosenDay = days[0];
      if ((chosenDay === 'day1' && spots?.day1.sold_out) || (chosenDay === 'day2' && spots?.day2.sold_out)) {
        setDays([]);
      }
    }
  }, [days, passType, spots]);

  // Debounced phone lookup
  useEffect(() => {
    if (lookupTimer.current) clearTimeout(lookupTimer.current);
    const sanitized = sanitize(phone);
    if (!sanitized) { setLookup(null); return; }
    lookupTimer.current = setTimeout(async () => {
      try {
        const r = await lookupPhone(sanitized, edition.id);
        setLookup(r);
        if (r.user.found) {
          if (r.user.name && !name) setName(r.user.name);
          if (r.user.email && !email) setEmail(r.user.email);
        }
        // lead capture: phone_entered
        captureLead(sanitized, edition.id, 'phone_entered');
      } catch {
        setLookup(null);
      }
    }, 300);
    return () => { if (lookupTimer.current) clearTimeout(lookupTimer.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phone, edition.id]);

  // Lead capture on name/email blur (debounced)
  function scheduleLead(step: 'name_entered' | 'details_entered') {
    const sanitized = sanitize(phone);
    if (!sanitized) return;
    if (leadTimer.current) clearTimeout(leadTimer.current);
    leadTimer.current = setTimeout(() => {
      captureLead(sanitized, edition.id, step, name || undefined);
    }, 1000);
  }

  const selectedRemaining = passType === 'campaign'
    ? (spots ? Math.min(spots.day1.remaining, spots.day2.remaining) : null)
    : days[0] === 'day1'
      ? spots?.day1.remaining ?? null
      : days[0] === 'day2'
        ? spots?.day2.remaining ?? null
        : null;
  const quantityLimit = Math.max(1, Math.min(MAX_TICKET_QUANTITY, selectedRemaining ?? MAX_TICKET_QUANTITY));

  useEffect(() => {
    setQuantity((current) => Math.min(current, quantityLimit));
  }, [quantityLimit]);

  // A code tied to one pass stops applying the moment the attendee switches.
  useEffect(() => {
    if (promo && !promoAppliesToPass(promo.rule, passType)) {
      setPromo(null);
      setPromoError("That code doesn't apply to the pass you've chosen.");
    }
  }, [promo, passType]);

  if (success) return <SuccessScreen pending={success.pending} editionName={edition.name} />;

  const ticketPrice = computePrice(edition, passType, days);
  const subtotal = ticketPrice * quantity;
  const tier = lookup && lookup.guild.active && !lookup.discount_blocked ? lookup.guild.tier : null;
  const cap = edition.pricing.adventurer_cap ?? Infinity;
  const guildDiscount = computeDiscount(ticketPrice, tier, cap);
  const promoDiscount = promo ? promoDiscountFor({ rule: promo.rule, ticketPrice, quantity }) : 0;
  // The two never stack — the larger one wins, ties going to Guild Path.
  const { amount: discount, source: discountSource } = winningDiscount({ guildDiscount, promoDiscount });
  const final = subtotal - discount;

  function toggleDay(d: Day) {
    if (passType === 'campaign') {
      setDays(['day1', 'day2']);
      return;
    }
    setDays([d]);
    scheduleLead('details_entered');
  }

  async function applyPromo() {
    const code = promoInput.trim();
    if (!code) return;
    const promoDays: Day[] = passType === 'campaign' ? ['day1', 'day2'] : days;
    if (promoDays.length === 0) { setPromoError('Pick a day first, then apply your code.'); return; }

    setPromoBusy(true);
    setPromoError(null);
    try {
      const result = await previewPromoCode({
        edition_id: edition.id,
        promo_code: code,
        pass_type: passType,
        days: promoDays,
        quantity,
        phone: sanitize(phone) || undefined,
      });
      setPromo(result);
      setPromoInput('');
    } catch (err: any) {
      setPromo(null);
      setPromoError(promoErrorMessage(err?.body?.error));
    } finally {
      setPromoBusy(false);
    }
  }

  function removePromo() {
    setPromo(null);
    setPromoError(null);
  }

  async function onSubmit(e: React.SubmitEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const sanitized = sanitize(phone);
    if (!sanitized) { setError('Enter a 10-digit phone number'); return; }
    if (!name.trim()) { setError('Name is required'); return; }
    if (!email.trim()) { setError('Email is required'); return; }
    const submitDays: Day[] = passType === 'campaign' ? ['day1', 'day2'] : days;
    if (passType === 'oneshot' && submitDays.length !== 1) { setError('Pick a day'); return; }

    setSubmitting(true);
    try {
      const request: ApiRegistrationDetails = {
        phone: sanitized, name: name.trim(), email: email.trim(),
        edition_id: edition.id, pass_type: passType, days: submitDays, quantity,
        promo_code: promo?.code ?? null,
      };
      const preview = await previewRegistration(request);
      // The Worker re-checks the code. If it has since been claimed out or
      // expired, stop here so the attendee sees the corrected total rather than
      // paying an amount the form no longer shows.
      const outcome = preview.promo;
      if (outcome && 'error' in outcome) {
        setPromo(null);
        setPromoError(promoErrorMessage(outcome.error));
        setError('Your promo code is no longer valid. Check the updated total before continuing.');
        return;
      }
      if (preview.payment_required) {
        setPaymentError(null);
        setUpiOpen({
          amount: preview.final_amount,
          paymentReference: preview.payment_reference,
          request,
        });
      } else {
        await registerForEdition({
          ...request,
          registration_id: preview.payment_reference,
          expected_amount: preview.final_amount,
        });
        setSuccess({ pending: false });
      }
    } catch (err: any) {
      const body = err?.body ?? {};
      if (body.error === 'sold_out') {
        const dayName = body.day === 'day1' ? weekdayName(edition.start_date) : weekdayName(edition.end_date);
        setError(quantity > 1
          ? `There aren't enough tickets left for ${dayName}. Reduce the quantity or choose the other day.`
          : `${dayName} just sold out. Please choose the other day.`);
        try { setSpots(await getEditionSpots(edition.id)); } catch {}
      } else if (body.error === 'registration_closed') {
        setError('Registration just closed. Please refresh.');
      } else {
        setError(body.error || 'Something went wrong. Please retry.');
      }
    } finally {
      setSubmitting(false);
    }
  }

  async function onPaymentClaimed() {
    if (!upiOpen) return;
    setPaymentSubmitting(true);
    setPaymentError(null);
    try {
      await registerForEdition({
        ...upiOpen.request,
        registration_id: upiOpen.paymentReference,
        expected_amount: upiOpen.amount,
      });
      setUpiOpen(null);
      setSuccess({ pending: true });
    } catch (err: any) {
      const body = err?.body ?? {};
      if (body.error === 'sold_out') {
        setPaymentError(`We couldn't record this because ${body.day === 'day1' ? weekdayName(edition.start_date) : weekdayName(edition.end_date)} just sold out. Don't pay again. Contact the REPLAY team with reference ${upiOpen.paymentReference}.`);
      } else if (body.error === 'amount_changed') {
        setPaymentError(`The amount changed before we could record this payment. Don't pay again. Contact the REPLAY team with reference ${upiOpen.paymentReference}.`);
      } else {
        setPaymentError(`We couldn't record your payment yet. Don't pay again. Retry this button, or contact the REPLAY team with reference ${upiOpen.paymentReference}.`);
      }
    } finally {
      setPaymentSubmitting(false);
    }
  }

  const day1SoldOut = spots?.day1.sold_out ?? false;
  const day2SoldOut = spots?.day2.sold_out ?? false;
  const bothSoldOut = spots?.both_sold_out ?? false;
  const campaignUnavailable = day1SoldOut || day2SoldOut;
  const tierMsg = tierLabel(lookup?.guild.tier ?? null);
  const day1Name = weekdayName(edition.start_date);
  const day2Name = weekdayName(edition.end_date);
  const storedNameProtected = Boolean(lookup?.user.found && lookup.user.name);
  const storedEmailProtected = Boolean(lookup?.user.found && lookup.user.email);

  return (
    <div>
      {availabilityError && (
        <p role="status" className="mb-4 text-sm font-medium text-[var(--color-error)]">
          Live availability is temporarily unavailable. The form will still prevent overbooking when you submit.
        </p>
      )}

      {lookup?.user.found && lookup.user.name && (
        <p className="mb-4"><span className="pill pill-green">Welcome back, {lookup.user.name}</span></p>
      )}
      {lookup?.discount_blocked && (
        <div className="card-flat p-4 mb-4 border-[var(--color-pink)]" style={{ background: '#FFF6E0' }}>
          <p className="text-sm font-medium">
            You've already registered for {edition.name}. Guild Path discount only applies to your first pass.
          </p>
        </div>
      )}
      {tierMsg && !lookup?.discount_blocked && (
        <div className="card-flat p-4 mb-4" style={{ background: '#E8F5F2', borderColor: 'var(--color-green)' }}>
          <p className="text-sm font-medium">{tierMsg}</p>
        </div>
      )}

      <form onSubmit={onSubmit} className="space-y-5">
        <div>
          <label htmlFor="phone" className="label-brutal">Phone</label>
          <input id="phone" type="tel" inputMode="numeric" autoComplete="tel" required maxLength={20} value={phone} onChange={(e) => setPhone(e.target.value)}
            className="input-brutal" placeholder="9876543210" />
        </div>
        <div>
          <label htmlFor="name" className="label-brutal">Name</label>
          <input id="name" type="text" autoComplete="name" required maxLength={120} value={name} onChange={(e) => setName(e.target.value)} readOnly={storedNameProtected}
            onBlur={() => scheduleLead('name_entered')}
            className="input-brutal" />
        </div>
        <div>
          <label htmlFor="email" className="label-brutal">Email</label>
          <input id="email" type="email" autoComplete="email" required maxLength={254} value={email} onChange={(e) => setEmail(e.target.value)} readOnly={storedEmailProtected}
            onBlur={() => scheduleLead('name_entered')}
            className="input-brutal" />
          {(storedNameProtected || storedEmailProtected) && (
            <p className="mt-2 text-xs text-gray-600">
              Existing details are protected. Contact the REPLAY team if they need correction.
            </p>
          )}
        </div>

        <fieldset>
          <legend className="label-brutal">Pass type</legend>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label className={`btn whitespace-normal text-center leading-tight ${passType === 'oneshot' ? 'btn-primary' : 'btn-secondary'} btn-block`}>
              <input type="radio" name="passType" value="oneshot" checked={passType === 'oneshot'} onChange={() => { setPassType('oneshot'); setDays([]); }} className="sr-only" />
              1-day pass — ₹{edition.pricing.oneshot}
            </label>
            <label className={`btn whitespace-normal text-center leading-tight ${passType === 'campaign' ? 'btn-primary' : 'btn-secondary'} btn-block ${campaignUnavailable ? 'opacity-50 pointer-events-none' : ''}`}>
              <input type="radio" name="passType" value="campaign" checked={passType === 'campaign'} onChange={() => { setPassType('campaign'); setDays(['day1','day2']); }} disabled={campaignUnavailable} className="sr-only" />
              2-day pass — ₹{edition.pricing.campaign}
            </label>
          </div>
        </fieldset>

        {passType === 'oneshot' && (
          <fieldset>
            <legend className="label-brutal">Day</legend>
            <div className="grid grid-cols-2 gap-3">
              <label className={`pill cursor-pointer justify-center py-3 ${days[0] === 'day1' ? 'pill-accent' : ''} ${day1SoldOut ? 'opacity-50' : ''}`}>
                <input type="radio" id="day1" name="day" checked={days[0] === 'day1'} onChange={() => toggleDay('day1')} disabled={day1SoldOut} aria-label={day1Name} className="sr-only" />
                {day1Name} {day1SoldOut && <span className="text-xs">(sold out)</span>}
              </label>
              <label className={`pill cursor-pointer justify-center py-3 ${days[0] === 'day2' ? 'pill-accent' : ''} ${day2SoldOut ? 'opacity-50' : ''}`}>
                <input type="radio" id="day2" name="day" checked={days[0] === 'day2'} onChange={() => toggleDay('day2')} disabled={day2SoldOut} aria-label={day2Name} className="sr-only" />
                {day2Name} {day2SoldOut && <span className="text-xs">(sold out)</span>}
              </label>
            </div>
          </fieldset>
        )}

        {ticketPrice > 0 && (
          <fieldset>
            <legend className="label-brutal">Tickets</legend>
            <div className="flex items-center gap-4">
              <button
                type="button"
                aria-label="Decrease ticket quantity"
                disabled={quantity <= 1}
                onClick={() => setQuantity((current) => Math.max(1, current - 1))}
                className="btn btn-secondary h-11 min-w-11 disabled:opacity-50"
                style={STEPPER_PADDING}
              >
                −
              </button>
              <output aria-live="polite" className="min-w-10 text-center text-2xl font-bold">{quantity}</output>
              <button
                type="button"
                aria-label="Increase ticket quantity"
                disabled={quantity >= quantityLimit}
                onClick={() => setQuantity((current) => Math.min(quantityLimit, current + 1))}
                className="btn btn-secondary h-11 min-w-11 disabled:opacity-50"
                style={STEPPER_PADDING}
              >
                +
              </button>
            </div>
            <p className="mt-2 text-xs text-gray-600">
              {selectedRemaining === null
                ? `Up to ${MAX_TICKET_QUANTITY} tickets per booking.`
                : `${selectedRemaining} ticket${selectedRemaining === 1 ? '' : 's'} currently available; maximum ${quantityLimit} in this booking.`}
            </p>
          </fieldset>
        )}

        {/* The error stays visible even when the price drops to zero mid-edit,
            so a code dropped by switching pass is explained rather than
            silently disappearing. */}
        {(ticketPrice > 0 || promoError) && (
          <div>
            <label htmlFor="promo" className="label-brutal">Promo code (optional)</label>
            {ticketPrice <= 0 ? null : promo ? (
              <div className="card-flat p-4" style={{ background: '#E8F5F2', borderColor: 'var(--color-green)' }}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-bold">{promo.code} applied</p>
                    <p className="mt-1 text-sm">{promo.message}</p>
                    {discountSource === 'guild' && promoDiscount > 0 && (
                      <p className="mt-2 text-xs text-gray-600">
                        Your Guild Path benefit saves you more, so we've kept that instead. The two don't stack.
                      </p>
                    )}
                  </div>
                  <button type="button" onClick={removePromo} className="btn btn-secondary shrink-0" style={COMPACT_BUTTON}>
                    Remove
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex gap-3">
                <input
                  id="promo" type="text" value={promoInput} maxLength={32}
                  autoComplete="off" autoCapitalize="characters" spellCheck={false}
                  onChange={(e) => { setPromoInput(e.target.value); setPromoError(null); }}
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); applyPromo(); } }}
                  className="input-brutal flex-1" placeholder="Enter code"
                />
                <button
                  type="button" onClick={applyPromo} disabled={promoBusy || !promoInput.trim()}
                  className="btn btn-secondary shrink-0 disabled:opacity-50"
                >
                  {promoBusy ? 'Checking…' : 'Apply'}
                </button>
              </div>
            )}
            {promoError && (
              <p role="alert" className="mt-2 text-sm font-medium text-[var(--color-error)]">{promoError}</p>
            )}
          </div>
        )}

        {ticketPrice > 0 && (
          <div className="card-flat p-4 bg-[var(--color-cream-dark)] border-l-[6px] border-[var(--color-orange)]">
            <div className="flex justify-between text-sm"><span>Tickets ({quantity} × ₹{ticketPrice})</span><span>₹{subtotal}</span></div>
            {discount > 0 && (
              <div className="flex justify-between text-sm text-[var(--color-orange-dark)] font-bold">
                <span>{discountSource === 'promo' ? `Promo ${promo?.code ?? ''}` : 'Guild Path (first ticket)'}</span>
                <span>−₹{discount}</span>
              </div>
            )}
            <div className="flex justify-between font-bold text-lg border-t-2 border-[var(--color-ink)] pt-2 mt-2"><span>You pay</span><span>₹{final}</span></div>
          </div>
        )}

        {error && <p role="alert" className="text-sm text-[var(--color-error)] font-medium">{error}</p>}

        <button type="submit" disabled={submitting || bothSoldOut} className="btn btn-primary btn-block">
          {submitting ? 'Submitting…' : `Continue with ${quantity} ticket${quantity === 1 ? '' : 's'}`}
        </button>
      </form>

      {upiOpen && (
        <UpiBottomSheet
          amount={upiOpen.amount}
          upiId={upiId}
          payeeName="REPLAY Convention"
          transactionRef={upiOpen.paymentReference}
          onPaid={onPaymentClaimed}
          onClose={() => { setPaymentError(null); setUpiOpen(null); }}
          isSubmitting={paymentSubmitting}
          error={paymentError}
        />
      )}
    </div>
  );
}

export default RegisterForm;
