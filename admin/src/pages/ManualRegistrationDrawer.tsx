import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { fetchAdmin, showApiError } from '@/lib/api';
import { toast } from 'sonner';

export default function ManualRegistrationDrawer() {
  const nav = useNavigate();
  const [phone, setPhone] = useState('');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [passType, setPassType] = useState<'oneshot' | 'campaign'>('oneshot');
  const [days, setDays] = useState<{ day1: boolean; day2: boolean }>({ day1: true, day2: false });
  const [amount, setAmount] = useState('800');
  const [status, setStatus] = useState<'confirmed' | 'pending'>('confirmed');
  const [sendEmail, setSendEmail] = useState(false);
  const [busy, setBusy] = useState(false);

  const phoneDigits = phone.replace(/\D/g, '');
  const selectedDays = (['day1', 'day2'] as const).filter((d) => days[d]);
  const valid = phoneDigits.length >= 10 && selectedDays.length > 0;

  async function submit() {
    if (!valid) { toast.error('Enter a valid phone and at least one day'); return; }
    setBusy(true);
    try {
      await fetchAdmin('/api/admin/registrations', {
        method: 'POST',
        body: JSON.stringify({
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
    <div className="fixed inset-y-0 right-0 z-50 w-full max-w-md overflow-y-auto border-l bg-background p-6 shadow-xl">
      <button onClick={() => nav('/registrations')} className="mb-4 text-sm text-muted-foreground">← Close</button>
      <h2 className="mb-4 text-xl font-bold">Add registration</h2>
      <div className="space-y-3">
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
          <div className="flex gap-4">
            <label className="flex items-center gap-1">
              <input type="checkbox" checked={days.day1} onChange={(e) => setDays((d) => ({ ...d, day1: e.target.checked }))} /> Sat
            </label>
            <label className="flex items-center gap-1">
              <input type="checkbox" checked={days.day2} onChange={(e) => setDays((d) => ({ ...d, day2: e.target.checked }))} /> Sun
            </label>
          </div>
        )}
        <L label="Amount (₹)">
          <input aria-label="Amount" type="number" value={amount} onChange={(e) => setAmount(e.target.value)} className="w-full rounded-md border px-3 py-2" />
        </L>
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
          disabled={busy}
          onClick={submit}
          className="w-full rounded-md bg-primary px-3 py-2 font-medium text-primary-foreground disabled:opacity-50"
        >
          {busy ? 'Adding…' : 'Add registration'}
        </button>
      </div>
    </div>
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
