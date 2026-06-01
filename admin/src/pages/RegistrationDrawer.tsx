import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { fetchAdmin, showApiError } from '@/lib/api';
import { toast } from 'sonner';

interface Detail {
  id: string;
  user_phone: string;
  pass_type: string;
  days: string[];
  amount_paid: number;
  payment_status: string;
  users?: { name: string | null; email: string | null } | null;
}

export default function RegistrationDrawer() {
  const { id } = useParams();
  const nav = useNavigate();
  const [reg, setReg] = useState<Detail | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetchAdmin<{ registration: Detail }>(`/api/admin/registrations/${id}`)
      .then((d) => setReg(d.registration))
      .catch(showApiError);
  }, [id]);

  async function patch(payment_status: string) {
    setBusy(true);
    try {
      await fetchAdmin(`/api/admin/registrations/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ payment_status }),
      });
      toast.success(`Marked ${payment_status}`);
      nav('/registrations');
    } catch (e) {
      showApiError(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-y-0 right-0 z-50 w-full max-w-md overflow-y-auto border-l bg-background p-6 shadow-xl">
      <button onClick={() => nav('/registrations')} className="mb-4 text-sm text-muted-foreground">
        ← Close
      </button>
      {!reg ? (
        <div>Loading…</div>
      ) : (
        <div className="space-y-3">
          <h2 className="text-xl font-bold">{reg.users?.name || '—'}</h2>
          <Field k="Phone" v={reg.user_phone} />
          <Field k="Email" v={reg.users?.email || '—'} />
          <Field k="Pass" v={reg.pass_type} />
          <Field k="Days" v={reg.days.join(', ')} />
          <Field k="Amount" v={'₹' + Number(reg.amount_paid).toLocaleString('en-IN')} />
          <Field k="Status" v={reg.payment_status} />
          <div className="flex gap-2 pt-4">
            {reg.payment_status !== 'confirmed' && (
              <button
                disabled={busy}
                onClick={() => patch('confirmed')}
                className="rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
              >
                Confirm
              </button>
            )}
            {reg.payment_status !== 'cancelled' && (
              <button
                disabled={busy}
                onClick={() => patch('cancelled')}
                className="rounded-md border border-destructive px-3 py-2 text-sm font-medium text-destructive disabled:opacity-50"
              >
                Cancel
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function Field({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between border-b py-1 text-sm">
      <span className="text-muted-foreground">{k}</span>
      <span>{v}</span>
    </div>
  );
}
