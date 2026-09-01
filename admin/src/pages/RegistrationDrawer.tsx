import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { fetchAdmin, showApiError, ApiError } from '@/lib/api';
import { oneDayPrice, type Day, type EditionRow, type PassType, type PaymentStatus } from '@/lib/types';
import { toast } from 'sonner';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';

interface Detail {
  id: string;
  edition_id: string;
  user_phone: string;
  pass_type: PassType;
  days: Day[];
  seats: number;
  amount_paid: number;
  payment_status: PaymentStatus;
  users?: { name: string | null; email: string | null } | null;
}

/** What the drawer lets an organiser correct. Status is a separate action. */
interface Draft {
  pass_type: PassType;
  day: Day;
  seats: string;
  amount_paid: string;
}

const EDIT_ERROR_COPY: Record<string, string> = {
  seats_in_use: 'Those seats have already checked in or booked a session. Cancel their bookings first.',
  day_checked_in: "That day can't be removed — someone on this registration already checked in for it.",
  pass_days_mismatch: 'A 2-day pass has to cover both days.',
  invalid_seats: 'Tickets must be a whole number from 1 to 20.',
  invalid_amount: 'Enter a non-negative amount.',
  no_changes: 'Nothing to save.',
};

function draftOf(reg: Detail): Draft {
  return {
    pass_type: reg.pass_type,
    // A campaign pass covers both days, so the radio only matters for oneshot;
    // it still needs a value to fall back to when the pass type is switched.
    day: reg.days.includes('day2') && !reg.days.includes('day1') ? 'day2' : 'day1',
    seats: String(reg.seats),
    amount_paid: String(reg.amount_paid),
  };
}

function daysOf(draft: Draft): Day[] {
  return draft.pass_type === 'campaign' ? ['day1', 'day2'] : [draft.day];
}

export default function RegistrationDrawer() {
  const { id } = useParams();
  const nav = useNavigate();
  const [reg, setReg] = useState<Detail | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [edition, setEdition] = useState<EditionRow | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetchAdmin<{ registration: Detail }>(`/api/admin/registrations/${id}`)
      .then((d) => { setReg(d.registration); setDraft(draftOf(d.registration)); })
      .catch(showApiError);
  }, [id]);

  // Only for the base-price hint below the amount, so a failure is silent.
  const editionId = reg?.edition_id;
  useEffect(() => {
    if (!editionId) return;
    fetchAdmin<{ editions: EditionRow[] }>('/api/admin/editions')
      .then((d) => setEdition(d.editions.find((e) => e.id === editionId) ?? null))
      .catch(() => {});
  }, [editionId]);

  const seats = draft ? Number(draft.seats) : Number.NaN;
  const amount = draft ? Number(draft.amount_paid) : Number.NaN;
  const valid = Number.isInteger(seats) && seats >= 1 && seats <= 20 && Number.isFinite(amount) && amount >= 0;

  const dirty = useMemo(() => {
    if (!reg || !draft) return false;
    const days = daysOf(draft);
    return (
      draft.pass_type !== reg.pass_type ||
      days.join() !== [...reg.days].sort().join() ||
      seats !== reg.seats ||
      amount !== Number(reg.amount_paid)
    );
  }, [reg, draft, seats, amount]);

  const basePrice = edition
    ? draft?.pass_type === 'campaign'
      ? edition.pricing.campaign
      : oneDayPrice(edition.pricing)
    : null;

  function fail(e: unknown) {
    if (e instanceof ApiError && EDIT_ERROR_COPY[e.message]) toast.error(EDIT_ERROR_COPY[e.message]);
    else if (e instanceof ApiError && e.message === 'sold_out') toast.error('That day is full, so the pass cannot move to it.');
    else showApiError(e);
  }

  async function save() {
    if (!draft || !valid) return;
    setBusy(true);
    try {
      const result = await fetchAdmin<{ registration: Detail }>(`/api/admin/registrations/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          pass_type: draft.pass_type,
          days: daysOf(draft),
          seats,
          amount_paid: amount,
        }),
      });
      // Reload from the response rather than closing: the organiser usually
      // wants to confirm the pass in the same visit.
      setReg((prev) => (prev ? { ...prev, ...result.registration } : prev));
      setDraft(draftOf({ ...(reg as Detail), ...result.registration }));
      toast.success('Registration updated');
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  }

  async function patchStatus(payment_status: PaymentStatus) {
    setBusy(true);
    try {
      const result = await fetchAdmin<{ email_sent: boolean; email_skipped: 'missing_email' | 'failed' | null }>(`/api/admin/registrations/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ payment_status }),
      });
      if (payment_status === 'confirmed' && result.email_skipped === 'missing_email') {
        toast.warning('Confirmed, but no email was sent because this user has no email address.');
      } else if (payment_status === 'confirmed' && result.email_skipped === 'failed') {
        toast.warning('Confirmed, but the confirmation email failed. Retry after checking the email service.');
      } else {
        toast.success(payment_status === 'confirmed' && result.email_sent ? 'Confirmed and emailed' : `Marked ${payment_status}`);
      }
      nav('/registrations');
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet open onOpenChange={(open) => { if (!open) nav('/registrations'); }}>
      <SheetContent className="w-full overflow-y-auto p-6 sm:max-w-md">
        <SheetHeader className="p-0 pr-8">
          <SheetTitle>{reg?.users?.name || 'Registration'}</SheetTitle>
          <SheetDescription>Correct the pass, then confirm or cancel it.</SheetDescription>
        </SheetHeader>
        {!reg || !draft ? (
          <div>Loading…</div>
        ) : (
          <div className="space-y-3">
            <Field k="Phone" v={reg.user_phone} />
            <Field k="Email" v={reg.users?.email || '—'} />
            <Field k="Status" v={reg.payment_status} />
            <p className="text-xs text-muted-foreground">
              Name, email, and phone belong to the person, not the pass —{' '}
              <Link to={`/users/${reg.user_phone}`} className="underline">edit them on their record</Link>.
            </p>

            <L label="Pass type">
              <select
                aria-label="Pass type"
                value={draft.pass_type}
                onChange={(e) => setDraft({ ...draft, pass_type: e.target.value as PassType })}
                className="w-full rounded-md border px-3 py-2"
              >
                <option value="oneshot">1-day pass</option>
                <option value="campaign">2-day pass</option>
              </select>
            </L>

            {draft.pass_type === 'oneshot' && (
              <fieldset className="flex gap-4">
                <legend className="mb-1 text-sm text-muted-foreground">Day</legend>
                <label className="flex items-center gap-1">
                  <input type="radio" name="edit-day" checked={draft.day === 'day1'} onChange={() => setDraft({ ...draft, day: 'day1' })} /> Sat
                </label>
                <label className="flex items-center gap-1">
                  <input type="radio" name="edit-day" checked={draft.day === 'day2'} onChange={() => setDraft({ ...draft, day: 'day2' })} /> Sun
                </label>
              </fieldset>
            )}

            <L label="Tickets">
              <input
                aria-label="Tickets" type="number" min="1" max="20" value={draft.seats}
                onChange={(e) => setDraft({ ...draft, seats: e.target.value })}
                className="w-full rounded-md border px-3 py-2"
              />
            </L>

            <L label="Amount (₹)">
              <input
                aria-label="Amount" type="number" min="0" value={draft.amount_paid}
                onChange={(e) => setDraft({ ...draft, amount_paid: e.target.value })}
                className="w-full rounded-md border px-3 py-2"
              />
            </L>
            {basePrice != null && Number.isFinite(basePrice) && (
              <div className="-mt-2 text-xs text-muted-foreground">
                Base for this pass: ₹{basePrice} per ticket. The amount is what was actually settled, so it is never recalculated for you.
              </div>
            )}

            <button
              disabled={busy || !dirty || !valid}
              onClick={save}
              className="w-full rounded-md bg-primary px-3 py-2 font-medium text-primary-foreground disabled:opacity-50"
            >
              {busy ? 'Saving…' : 'Save changes'}
            </button>

            <div className="flex gap-2 border-t pt-4">
              {reg.payment_status !== 'confirmed' && (
                <button
                  disabled={busy}
                  onClick={() => patchStatus('confirmed')}
                  className="rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
                >
                  Confirm
                </button>
              )}
              {reg.payment_status !== 'cancelled' && (
                <button
                  disabled={busy}
                  onClick={() => patchStatus('cancelled')}
                  className="rounded-md border border-destructive px-3 py-2 text-sm font-medium text-destructive disabled:opacity-50"
                >
                  Cancel
                </button>
              )}
            </div>
            {dirty && (
              <p className="text-xs text-destructive">Unsaved changes — save before confirming, or they are lost.</p>
            )}
          </div>
        )}
      </SheetContent>
    </Sheet>
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

function L({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-1 text-sm text-muted-foreground">{label}</div>
      {children}
    </div>
  );
}
