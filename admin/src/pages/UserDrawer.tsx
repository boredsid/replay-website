import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { fetchAdmin, showApiError } from '@/lib/api';
import { toast } from 'sonner';
import type { UserDetail } from '@/lib/types';

export default function UserDrawer() {
  const nav = useNavigate();
  const { phone } = useParams();
  const [user, setUser] = useState<UserDetail | null>(null);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!phone) return;
    (async () => {
      try {
        const res = await fetchAdmin<{ user: UserDetail }>(`/api/admin/users/${phone}`);
        setUser(res.user);
        setName(res.user.name || '');
        setEmail(res.user.email || '');
        setNotes(res.user.notes || '');
      } catch (e) { showApiError(e); }
    })();
  }, [phone]);

  async function saveDetails() {
    setBusy(true);
    try {
      await fetchAdmin(`/api/admin/users/${phone}`, { method: 'PATCH', body: JSON.stringify({ name, email, notes }) });
      toast.success('User saved');
      nav('/users');
    } catch (e) { showApiError(e); } finally { setBusy(false); }
  }

  async function changePhone() {
    const next = prompt('New phone number (10 digits):', '');
    if (!next) return;
    if (!confirm(`Change phone from ${phone} to ${next}? This moves all their registrations and orders.`)) return;
    try {
      await fetchAdmin(`/api/admin/users/${phone}/change-phone`, { method: 'POST', body: JSON.stringify({ phone: next }) });
      toast.success('Phone changed');
      nav('/users');
    } catch (e) { showApiError(e); }
  }

  if (!user) return null;

  return (
    <div className="fixed inset-y-0 right-0 z-50 w-full max-w-md overflow-y-auto border-l bg-background p-6 shadow-xl">
      <button onClick={() => nav('/users')} className="mb-4 text-sm text-muted-foreground">← Close</button>
      <h2 className="mb-1 text-xl font-bold">{user.name || '(no name)'}</h2>
      <div className="mb-4 font-mono text-sm text-muted-foreground">{user.phone}</div>

      <div className="space-y-3">
        <Field label="Name"><input aria-label="Name" value={name} onChange={(e) => setName(e.target.value)} className="w-full rounded-md border px-3 py-2" /></Field>
        <Field label="Email"><input aria-label="Email" value={email} onChange={(e) => setEmail(e.target.value)} className="w-full rounded-md border px-3 py-2" /></Field>
        <Field label="Notes"><textarea aria-label="Notes" value={notes} onChange={(e) => setNotes(e.target.value)} className="w-full rounded-md border px-3 py-2" /></Field>
        <button disabled={busy} onClick={saveDetails} className="w-full rounded-md bg-primary px-3 py-2 font-medium text-primary-foreground disabled:opacity-50">
          {busy ? 'Saving…' : 'Save details'}
        </button>
        <button onClick={changePhone} className="w-full rounded-md border px-3 py-2 text-sm">Change phone number</button>
      </div>

      <div className="mt-6 border-t pt-4">
        <div className="mb-2 text-sm font-semibold">Registrations ({user.registrations.length})</div>
        <div className="space-y-1 text-sm">
          {user.registrations.map((r) => (
            <div key={r.id} className="flex justify-between">
              <span>{r.editions?.slug || '—'} · {r.pass_type} · {r.days.join('+')}</span>
              <span className="text-muted-foreground">₹{r.amount_paid} · {r.payment_status}</span>
            </div>
          ))}
          {user.registrations.length === 0 && <div className="text-muted-foreground">None.</div>}
        </div>
        {user.orders.length > 0 && (
          <>
            <div className="mt-4 mb-2 text-sm font-semibold">Orders ({user.orders.length})</div>
            <div className="space-y-1 text-sm">
              {user.orders.map((o) => (
                <div key={o.id} className="flex justify-between"><span>{o.id.slice(0, 8)}</span><span className="text-muted-foreground">₹{o.total} · {o.payment_status}</span></div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (<div><div className="mb-1 text-sm text-muted-foreground">{label}</div>{children}</div>);
}
