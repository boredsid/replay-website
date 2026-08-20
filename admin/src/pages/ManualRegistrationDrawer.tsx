import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { fetchAdmin, showApiError } from '@/lib/api';
import type { EditionRow } from '@/lib/types';
import { toast } from 'sonner';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';

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
      : selectedEdition.pricing.oneshot[selectedDays[0] ?? 'day1']
    : null;

  useEffect(() => {
    if (baseHint != null) setAmount(String(baseHint));
  }, [baseHint]);

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
            <option value="oneshot">Oneshot</option>
            <option value="campaign">Campaign (both days)</option>
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
        <L label="Amount (₹)">
          <input aria-label="Amount" type="number" min="0" value={amount} onChange={(e) => setAmount(e.target.value)} className="w-full rounded-md border px-3 py-2" />
        </L>
        {baseHint != null && (
          <div className="-mt-2 text-xs text-muted-foreground">Base for this pass: ₹{baseHint}</div>
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
