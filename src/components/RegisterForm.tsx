// src/components/RegisterForm.tsx
import { useEffect, useRef, useState } from 'react';
import { getEditionSpots, lookupPhone, registerForEdition, captureLead } from '../lib/worker';
import type { ApiEditionSpotsResponse, ApiLookupPhoneResponse, EditionRow, Day, PassType } from '../lib/types';
import { UpiBottomSheet } from './UpiBottomSheet';
import { SuccessScreen } from './SuccessScreen';
import { weekdayName } from '../lib/edition-format';

export interface RegisterFormProps {
  edition: EditionRow;
  upiId: string;
}

function sanitize(p: string): string {
  const d = p.replace(/\D/g, '');
  return d.length >= 10 ? d.slice(-10) : '';
}

function tierLabel(t: string | null) {
  if (t === 'guildmaster') return 'Guildmaster (free pass)';
  if (t === 'adventurer') return 'Adventurer (100% off, ₹1,000 max discount)';
  if (t === 'initiate') return 'Initiate (20% off)';
  return null;
}

function computePrice(edition: EditionRow, passType: PassType, days: Day[]): number {
  if (passType === 'campaign') return edition.pricing.campaign;
  return days.length === 1 ? edition.pricing.oneshot[days[0]] : 0;
}

function computeDiscount(base: number, tier: string | null, cap: number): number {
  if (!tier) return 0;
  if (tier === 'initiate') return Math.round(base * 0.2);
  if (tier === 'adventurer') return Math.min(base, cap);
  if (tier === 'guildmaster') return base;
  return 0;
}

function formatDateRange(start: string, end: string): string {
  const first = new Date(`${start}T00:00:00Z`);
  const second = new Date(`${end}T00:00:00Z`);
  if (Number.isNaN(first.valueOf()) || Number.isNaN(second.valueOf())) return `${start} – ${end}`;
  return `${first.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })} – ${second.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })}`;
}

export function RegisterForm({ edition, upiId }: RegisterFormProps) {
  const [spots, setSpots] = useState<ApiEditionSpotsResponse | null>(null);
  const [availabilityError, setAvailabilityError] = useState(false);
  const [phone, setPhone] = useState('');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [passType, setPassType] = useState<PassType>('oneshot');
  const [days, setDays] = useState<Day[]>([]);
  const [lookup, setLookup] = useState<ApiLookupPhoneResponse | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [upiOpen, setUpiOpen] = useState<{ amount: number; regId: string } | null>(null);
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
    }
  }, [passType, spots]);

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

  if (success) return <SuccessScreen pending={success.pending} editionName={edition.name} />;

  const base = computePrice(edition, passType, days);
  const tier = lookup && lookup.guild.active && !lookup.discount_blocked ? lookup.guild.tier : null;
  const cap = edition.pricing.adventurer_cap ?? Infinity;
  const discount = computeDiscount(base, tier, cap);
  const final = base - discount;

  function toggleDay(d: Day) {
    if (passType === 'campaign') {
      setDays(['day1', 'day2']);
      return;
    }
    setDays([d]);
    scheduleLead('details_entered');
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
      const res = await registerForEdition({
        phone: sanitized, name: name.trim(), email: email.trim(),
        edition_id: edition.id, pass_type: passType, days: submitDays,
      });
      if (res.payment_required) {
        setUpiOpen({ amount: res.final_amount, regId: res.registration_id });
      } else {
        setSuccess({ pending: false });
      }
    } catch (err: any) {
      const body = err?.body ?? {};
      if (body.error === 'sold_out') {
        setError(`${body.day === 'day1' ? weekdayName(edition.start_date) : weekdayName(edition.end_date)} just sold out. Please choose the other day.`);
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

  const day1SoldOut = spots?.day1.sold_out ?? false;
  const day2SoldOut = spots?.day2.sold_out ?? false;
  const bothSoldOut = spots?.both_sold_out ?? false;
  const campaignUnavailable = day1SoldOut || day2SoldOut;
  const tierMsg = tierLabel(lookup?.guild.tier ?? null);
  const day1Price = edition.pricing.oneshot.day1;
  const day2Price = edition.pricing.oneshot.day2;
  const day1Name = weekdayName(edition.start_date);
  const day2Name = weekdayName(edition.end_date);
  const dayPricesDiffer = day1Price !== day2Price;
  const dayPassPriceLabel = dayPricesDiffer
    ? `from ₹${Math.min(day1Price, day2Price)}`
    : `₹${day1Price}`;
  const storedNameProtected = Boolean(lookup?.user.found && lookup.user.name);
  const storedEmailProtected = Boolean(lookup?.user.found && lookup.user.email);

  return (
    <div className="container-x section max-w-xl">
      <span className="pill pill-yellow mb-4">Ticket details</span>
      <h2 className="text-4xl md:text-5xl mb-3">{edition.name}</h2>
      <p className="text-gray-700 mb-8">{formatDateRange(edition.start_date, edition.end_date)} · {edition.venue}</p>
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

      <form onSubmit={onSubmit} className="card-brutal p-8 space-y-5">
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
          <div className="grid grid-cols-2 gap-3">
            <label className={`btn ${passType === 'oneshot' ? 'btn-primary' : 'btn-secondary'} btn-block`}>
              <input type="radio" name="passType" value="oneshot" checked={passType === 'oneshot'} onChange={() => setPassType('oneshot')} className="sr-only" />
              Day pass — {dayPassPriceLabel}
            </label>
            <label className={`btn ${passType === 'campaign' ? 'btn-primary' : 'btn-secondary'} btn-block ${campaignUnavailable ? 'opacity-50 pointer-events-none' : ''}`}>
              <input type="radio" name="passType" value="campaign" checked={passType === 'campaign'} onChange={() => { setPassType('campaign'); setDays(['day1','day2']); }} disabled={campaignUnavailable} className="sr-only" />
              Campaign ₹{edition.pricing.campaign}
            </label>
          </div>
        </fieldset>

        {passType === 'oneshot' && (
          <fieldset>
            <legend className="label-brutal">Day</legend>
            <div className="grid grid-cols-2 gap-3">
              <label className={`pill cursor-pointer justify-center py-3 ${days[0] === 'day1' ? 'pill-accent' : ''} ${day1SoldOut ? 'opacity-50' : ''}`}>
                <input type="radio" id="day1" name="day" checked={days[0] === 'day1'} onChange={() => toggleDay('day1')} disabled={day1SoldOut} aria-label={day1Name} className="sr-only" />
                {day1Name} · ₹{day1Price} {day1SoldOut && <span className="text-xs">(sold out)</span>}
              </label>
              <label className={`pill cursor-pointer justify-center py-3 ${days[0] === 'day2' ? 'pill-accent' : ''} ${day2SoldOut ? 'opacity-50' : ''}`}>
                <input type="radio" id="day2" name="day" checked={days[0] === 'day2'} onChange={() => toggleDay('day2')} disabled={day2SoldOut} aria-label={day2Name} className="sr-only" />
                {day2Name} · ₹{day2Price} {day2SoldOut && <span className="text-xs">(sold out)</span>}
              </label>
            </div>
          </fieldset>
        )}

        {base > 0 && (
          <div className="card-flat p-4 bg-[var(--color-cream-dark)] border-l-[6px] border-[var(--color-orange)]">
            <div className="flex justify-between text-sm"><span>Base price</span><span>₹{base}</span></div>
            {discount > 0 && (
              <div className="flex justify-between text-sm text-[var(--color-orange-dark)] font-bold"><span>Discount</span><span>−₹{discount}</span></div>
            )}
            <div className="flex justify-between font-bold text-lg border-t-2 border-[var(--color-ink)] pt-2 mt-2"><span>You pay</span><span>₹{final}</span></div>
          </div>
        )}

        {error && <p role="alert" className="text-sm text-[var(--color-error)] font-medium">{error}</p>}

        <button type="submit" disabled={submitting || bothSoldOut} className="btn btn-primary btn-block">
          {submitting ? 'Submitting…' : 'Register'}
        </button>
      </form>

      {upiOpen && (
        <UpiBottomSheet
          amount={upiOpen.amount}
          upiId={upiId}
          payeeName="REPLAY Convention"
          transactionRef={upiOpen.regId}
          onPaid={() => { setUpiOpen(null); setSuccess({ pending: true }); }}
          onClose={() => setUpiOpen(null)}
        />
      )}
    </div>
  );
}

export default RegisterForm;
