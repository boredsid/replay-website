import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { fetchAdmin, showApiError, ApiError } from '@/lib/api';
import { oneDayPrice, type EditionRow } from '@/lib/types';
import { toast } from 'sonner';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';

const PROMO_ERROR_COPY: Record<string, string> = {
  promo_not_found: 'No such code for this edition.',
  promo_inactive: 'That code is switched off.',
  promo_not_started: "That code isn't active yet.",
  promo_expired: 'That code has expired.',
  promo_pass_type: "That code doesn't apply to this pass type.",
  // Manual registrations are one seat at a time, so a bulk code never clears
  // its floor here — say so rather than leaving the admin guessing.
  promo_min_quantity: 'That code needs a multi-ticket booking, so it cannot be applied here.',
  promo_exhausted: 'That code has been fully claimed.',
  promo_already_used: 'This phone has already used that code.',
};

export default function ManualRegistrationDrawer() {
  const nav = useNavigate();
  const [phone, setPhone] = useState('');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [passType, setPassType] = useState<'oneshot' | 'campaign'>('oneshot');
  const [day, setDay] = useState<'day1' | 'day2'>('day1');
  const [amount, setAmount] = useState('700');
  const [status, setStatus] = useState<'confirmed' | 'pending'>('confirmed');
  const [sendEmail, setSendEmail] = useState(false);
  const [busy, setBusy] = useState(false);
  const [promoInput, setPromoInput] = useState('');
  const [promo, setPromo] = useState<{ code: string; message: string; discount: number } | null>(null);
  const [promoBusy, setPromoBusy] = useState(false);
  const [promoError, setPromoError] = useState<string | null>(null);

  const [editions, setEditions] = useState<EditionRow[]>([]);
  const [edition, setEdition] = useState('');

  useEffect(() => {
    (async () => {
      try {
        const res = await fetchAdmin<{ editions: EditionRow[] }>('/api/admin/editions');
        setEditions(res.editions);
        if (res.editions[0]) setEdition(res.editions[0].slug);
      } catch { /* selector stays empty; worker falls back to current edition */ }
    })();
  }, []);

  const phoneDigits = phone.replace(/\D/g, '');
  const selectedDays: Array<'day1' | 'day2'> = [day];
  const numericAmount = Number(amount);
  const valid = phoneDigits.length === 10 && Number.isFinite(numericAmount) && numericAmount >= 0;

  const selectedEdition = editions.find((e) => e.slug === edition);
  const baseHint = selectedEdition
    ? passType === 'campaign'
      ? selectedEdition.pricing.campaign
      : oneDayPrice(selectedEdition.pricing)
    : null;

  // A discount computed for one pass says nothing about another, so switching
  // pass or edition drops it rather than carrying a stale number forward.
  useEffect(() => {
    setPromo(null);
    setPromoError(null);
  }, [passType, edition]);

  useEffect(() => {
    if (baseHint != null) setAmount(String(Math.max(0, baseHint - (promo?.discount ?? 0))));
  }, [baseHint, promo]);

  async function applyPromo() {
    const code = promoInput.trim();
    if (!code) return;
    if (!selectedEdition || baseHint == null) { setPromoError('Pick an edition first.'); return; }
    setPromoBusy(true);
    setPromoError(null);
    try {
      const res = await fetchAdmin<{ promo: { code: string; message: string; discount: number } }>(
        '/api/admin/promo-codes/validate',
        {
          method: 'POST',
          body: JSON.stringify({
            edition_id: selectedEdition.id,
            code,
            pass_type: passType,
            quantity: 1,
            ticket_price: baseHint,
            phone: phoneDigits,
          }),
        },
      );
      setPromo(res.promo);
      setPromoInput('');
    } catch (e) {
      setPromo(null);
      setPromoError(e instanceof ApiError ? PROMO_ERROR_COPY[e.message] ?? e.message : 'Could not check that code.');
    } finally {
      setPromoBusy(false);
    }
  }

  async function submit() {
    if (!valid) { toast.error('Enter a 10-digit phone and a non-negative amount'); return; }
    setBusy(true);
    try {
      await fetchAdmin('/api/admin/registrations', {
        method: 'POST',
        body: JSON.stringify({
          edition,
          phone: phoneDigits,
          name,
          email,
          pass_type: passType,
          days: passType === 'campaign' ? ['day1', 'day2'] : selectedDays,
          amount_paid: Number(amount),
          promo_code: promo?.code ?? null,
          payment_status: status,
          send_email: sendEmail,
        }),
      });
      toast.success('Registration added');
      nav('/registrations');
    } catch (e) { showApiError(e); } finally { setBusy(false); }
  }

  return (
    <Sheet open onOpenChange={(open) => { if (!open) nav('/registrations'); }}>
      <SheetContent className="w-full overflow-y-auto p-6 sm:max-w-md">
        <SheetHeader className="p-0 pr-8">
          <SheetTitle>Add registration</SheetTitle>
          <SheetDescription>Create a validated manual registration for a selected edition.</SheetDescription>
        </SheetHeader>
        <div className="space-y-3">
        <L label="Edition">
          <select aria-label="Edition" value={edition} onChange={(e) => setEdition(e.target.value)} className="w-full rounded-md border px-3 py-2">
            {editions.map((e) => (<option key={e.id} value={e.slug}>{e.slug} — {e.name}</option>))}
          </select>
        </L>
        <L label="Phone">
          <input aria-label="Phone" value={phone} onChange={(e) => setPhone(e.target.value)} className="w-full rounded-md border px-3 py-2" />
        </L>
        <L label="Name">
          <input aria-label="Name" value={name} onChange={(e) => setName(e.target.value)} className="w-full rounded-md border px-3 py-2" />
        </L>
        <L label="Email">
          <input aria-label="Email" value={email} onChange={(e) => setEmail(e.target.value)} className="w-full rounded-md border px-3 py-2" />
        </L>
        <L label="Pass type">
          <select aria-label="Pass type" value={passType} onChange={(e) => setPassType(e.target.value as 'oneshot' | 'campaign')} className="w-full rounded-md border px-3 py-2">
            <option value="oneshot">1-day pass</option>
            <option value="campaign">2-day pass</option>
          </select>
        </L>
        {passType === 'oneshot' && (
          <fieldset className="flex gap-4">
            <legend className="mb-1 text-sm text-muted-foreground">Day</legend>
            <label className="flex items-center gap-1">
              <input type="radio" name="manual-day" checked={day === 'day1'} onChange={() => setDay('day1')} /> Sat
            </label>
            <label className="flex items-center gap-1">
              <input type="radio" name="manual-day" checked={day === 'day2'} onChange={() => setDay('day2')} /> Sun
            </label>
          </fieldset>
        )}
        <L label="Promo code">
          {promo ? (
            <div className="rounded-md border bg-muted/40 p-3 text-sm">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="font-mono font-bold">{promo.code}</div>
                  <div className="text-muted-foreground">{promo.message}</div>
                  <div className="mt-1">Worth ₹{promo.discount} on this pass.</div>
                </div>
                <button
                  type="button"
                  onClick={() => { setPromo(null); setPromoError(null); }}
                  className="shrink-0 rounded-md border px-2 py-1 text-xs"
                >
                  Remove
                </button>
              </div>
            </div>
          ) : (
            <div className="flex gap-2">
              <input
                aria-label="Promo code" value={promoInput} maxLength={32} spellCheck={false}
                onChange={(e) => { setPromoInput(e.target.value.toUpperCase()); setPromoError(null); }}
                className="w-full rounded-md border px-3 py-2 font-mono uppercase" placeholder="Optional"
              />
              <button
                type="button" onClick={applyPromo} disabled={promoBusy || !promoInput.trim()}
                className="shrink-0 rounded-md border px-3 py-2 text-sm disabled:opacity-50"
              >
                {promoBusy ? 'Checking…' : 'Apply'}
              </button>
            </div>
          )}
          {promoError && <div className="mt-1 text-xs text-destructive">{promoError}</div>}
        </L>
        <L label="Amount (₹)">
          <input aria-label="Amount" type="number" min="0" value={amount} onChange={(e) => setAmount(e.target.value)} className="w-full rounded-md border px-3 py-2" />
        </L>
        {baseHint != null && (
          <div className="-mt-2 text-xs text-muted-foreground">
            Base for this pass: ₹{baseHint}
            {promo ? ` · less ₹${promo.discount} promo. Override the amount if it settled differently.` : ''}
          </div>
        )}
        <L label="Status">
          <select aria-label="Status" value={status} onChange={(e) => setStatus(e.target.value as 'confirmed' | 'pending')} className="w-full rounded-md border px-3 py-2">
            <option value="confirmed">Confirmed</option>
            <option value="pending">Pending</option>
          </select>
        </L>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={sendEmail} onChange={(e) => setSendEmail(e.target.checked)} /> Send confirmation email
        </label>
        <button
          disabled={busy || !valid}
          onClick={submit}
          className="w-full rounded-md bg-primary px-3 py-2 font-medium text-primary-foreground disabled:opacity-50"
        >
          {busy ? 'Adding…' : 'Add registration'}
        </button>
        </div>
      </SheetContent>
    </Sheet>
  );
}

function L({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-1 text-sm text-muted-foreground">{label}</div>
      {children}
    </div>
  );
}
