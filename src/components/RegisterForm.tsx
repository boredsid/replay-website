// src/components/RegisterForm.tsx
import { useEffect, useRef, useState } from 'react';
import { getEditionSpots, lookupPhone, registerForEdition, captureLead } from '../lib/worker';
import type { ApiEditionSpotsResponse, ApiLookupPhoneResponse, EditionRow, Day, PassType } from '../lib/types';
import { UpiBottomSheet } from './UpiBottomSheet';
import { SuccessScreen } from './SuccessScreen';

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

export function RegisterForm({ edition, upiId }: RegisterFormProps) {
  const [spots, setSpots] = useState<ApiEditionSpotsResponse | null>(null);
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
    getEditionSpots(edition.id).then((r) => { if (!cancelled) setSpots(r); }).catch(() => {});
    return () => { cancelled = true; };
  }, [edition.id]);

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

  async function onSubmit(e: React.FormEvent) {
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
        setError(`Day ${body.day === 'day1' ? 'Saturday' : 'Sunday'} just sold out. Try the other day or campaign pass.`);
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
  const tierMsg = tierLabel(lookup?.guild.tier ?? null);

  return (
    <div className="px-6 py-12 max-w-md mx-auto">
      <h1 className="text-3xl font-bold mb-2">Register for {edition.name}</h1>
      <p className="text-gray-700 mb-6">{edition.start_date} – {edition.end_date} · {edition.venue}</p>

      {lookup?.user.found && lookup.user.name && (
        <p className="mb-4 text-sm text-gray-700">Welcome back, {lookup.user.name}.</p>
      )}
      {lookup?.discount_blocked && (
        <p className="mb-4 text-sm text-amber-800 bg-amber-50 border border-amber-200 p-3 rounded">
          You've already registered for {edition.name}. Guild Path discount only applies to your first pass.
        </p>
      )}
      {tierMsg && !lookup?.discount_blocked && (
        <p className="mb-4 text-sm text-green-800 bg-green-50 border border-green-200 p-3 rounded">
          {tierMsg}
        </p>
      )}

      <form onSubmit={onSubmit} className="space-y-4">
        <div>
          <label htmlFor="phone" className="block text-sm font-medium mb-1">Phone</label>
          <input id="phone" type="tel" autoComplete="tel" value={phone} onChange={(e) => setPhone(e.target.value)}
            className="w-full border border-[#F0E6D8] rounded px-3 py-2" placeholder="9876543210" />
        </div>
        <div>
          <label htmlFor="name" className="block text-sm font-medium mb-1">Name</label>
          <input id="name" type="text" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)}
            onBlur={() => scheduleLead('name_entered')}
            className="w-full border border-[#F0E6D8] rounded px-3 py-2" />
        </div>
        <div>
          <label htmlFor="email" className="block text-sm font-medium mb-1">Email</label>
          <input id="email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)}
            onBlur={() => scheduleLead('name_entered')}
            className="w-full border border-[#F0E6D8] rounded px-3 py-2" />
        </div>

        <fieldset className="space-y-2">
          <legend className="text-sm font-medium mb-1">Pass type</legend>
          <label className="flex items-center gap-2">
            <input type="radio" name="passType" value="oneshot" checked={passType === 'oneshot'} onChange={() => setPassType('oneshot')} />
            <span>Oneshot (one day · ₹{edition.pricing.oneshot.day1})</span>
          </label>
          <label className="flex items-center gap-2">
            <input type="radio" name="passType" value="campaign" checked={passType === 'campaign'} onChange={() => { setPassType('campaign'); setDays(['day1','day2']); }} disabled={bothSoldOut} />
            <span>Campaign (both days · ₹{edition.pricing.campaign})</span>
          </label>
        </fieldset>

        {passType === 'oneshot' && (
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium mb-1">Day</legend>
            <label className="flex items-center gap-2">
              <input type="radio" id="day1" name="day" checked={days[0] === 'day1'} onChange={() => toggleDay('day1')} disabled={day1SoldOut} aria-label="Saturday" />
              <span>Saturday {day1SoldOut && <span className="text-red-700 text-xs">(sold out)</span>}</span>
            </label>
            <label className="flex items-center gap-2">
              <input type="radio" id="day2" name="day" checked={days[0] === 'day2'} onChange={() => toggleDay('day2')} disabled={day2SoldOut} aria-label="Sunday" />
              <span>Sunday {day2SoldOut && <span className="text-red-700 text-xs">(sold out)</span>}</span>
            </label>
          </fieldset>
        )}

        {base > 0 && (
          <div className="border border-[#F0E6D8] rounded p-3 text-sm">
            <div className="flex justify-between"><span>Base price</span><span>₹{base}</span></div>
            {discount > 0 && (
              <>
                <div className="flex justify-between text-green-800"><span>Discount</span><span>–₹{discount}</span></div>
                <div className="flex justify-between font-bold border-t border-[#F0E6D8] pt-2 mt-2"><span>You pay</span><span>₹{final}</span></div>
              </>
            )}
            {discount === 0 && (
              <div className="flex justify-between font-bold border-t border-[#F0E6D8] pt-2 mt-2"><span>You pay</span><span>₹{final}</span></div>
            )}
          </div>
        )}

        {error && <p className="text-sm text-red-700">{error}</p>}

        <button type="submit" disabled={submitting || bothSoldOut} className="w-full bg-[var(--color-replay-orange)] text-white py-3 rounded font-bold disabled:opacity-50">
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
