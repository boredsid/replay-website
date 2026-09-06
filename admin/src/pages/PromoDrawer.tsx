import { useEffect, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { fetchAdmin, showApiError, ApiError } from '@/lib/api';
import type { EditionRow, PassType, PromoCodeRow, PromoDiscountType, PromoScope } from '@/lib/types';

type Form = {
  edition_id: string;
  code: string;
  applied_message: string;
  internal_note: string;
  discount_type: PromoDiscountType;
  discount_value: string;
  max_discount: string;
  scope: PromoScope;
  pass_type: PassType | '';
  starts_at: string;
  ends_at: string;
  max_redemptions: string;
  max_per_phone: string;
  min_quantity: string;
  is_active: boolean;
};

function isoToIstInput(value: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date(value));
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value ?? '';
  return `${part('year')}-${part('month')}-${part('day')}T${part('hour')}:${part('minute')}`;
}

function istInputToIso(value: string): string {
  const parsed = new Date(`${value}:00+05:30`);
  if (Number.isNaN(parsed.getTime())) throw new Error('invalid_timestamp');
  return parsed.toISOString();
}

const EMPTY: Form = {
  edition_id: '',
  code: '',
  applied_message: '',
  internal_note: '',
  discount_type: 'percent',
  discount_value: '',
  max_discount: '',
  scope: 'booking',
  pass_type: '',
  starts_at: '',
  ends_at: '',
  max_redemptions: '',
  max_per_phone: '1',
  min_quantity: '1',
  is_active: true,
};

const SAVE_ERROR_COPY: Record<string, string> = {
  promo_code_exists: 'That code already exists for this edition. Pick a different word.',
  invalid_code: 'Use 2–32 letters, digits, hyphens or underscores, starting with a letter or digit.',
  invalid_discount_value: 'Enter a discount above zero — and at most 100 for a percentage.',
  invalid_max_discount: 'A maximum discount only applies to a percentage code.',
  invalid_validity_window: 'The end time must be after the start time.',
  invalid_applied_message: 'Write the message attendees see, up to 300 characters.',
  invalid_min_quantity: 'Minimum tickets must be a whole number, one or more.',
};

export default function PromoDrawer() {
  const nav = useNavigate();
  const { id } = useParams();
  const [search] = useSearchParams();
  const isNew = !id;
  const [editions, setEditions] = useState<EditionRow[]>([]);
  const [form, setForm] = useState<Form>(EMPTY);
  const [redemptions, setRedemptions] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const editionsResponse = await fetchAdmin<{ editions: EditionRow[] }>('/api/admin/editions');
        setEditions(editionsResponse.editions);
        if (isNew) {
          const requested = search.get('edition_id');
          const edition = editionsResponse.editions.find((item) => item.id === requested)
            ?? editionsResponse.editions.find((item) => item.is_current)
            ?? editionsResponse.editions[0];
          setForm((current) => ({ ...current, edition_id: edition?.id ?? '' }));
        } else {
          const response = await fetchAdmin<{ promo_code: PromoCodeRow }>(`/api/admin/promo-codes/${id}`);
          const promo = response.promo_code;
          setRedemptions(promo.redemption_count);
          setForm({
            edition_id: promo.edition_id,
            code: promo.code,
            applied_message: promo.applied_message,
            internal_note: promo.internal_note ?? '',
            discount_type: promo.discount_type,
            discount_value: String(promo.discount_value),
            max_discount: promo.max_discount === null ? '' : String(promo.max_discount),
            scope: promo.scope,
            pass_type: promo.pass_type ?? '',
            starts_at: promo.starts_at ? isoToIstInput(promo.starts_at) : '',
            ends_at: promo.ends_at ? isoToIstInput(promo.ends_at) : '',
            max_redemptions: promo.max_redemptions === null ? '' : String(promo.max_redemptions),
            max_per_phone: String(promo.max_per_phone),
            min_quantity: String(promo.min_quantity ?? 1),
            is_active: promo.is_active,
          });
        }
        setLoaded(true);
      } catch (error) {
        showApiError(error);
        nav('/promos');
      }
    })();
  }, [id, isNew, nav, search]);

  function set<K extends keyof Form>(key: K, value: Form[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function reportSaveError(error: unknown) {
    if (error instanceof ApiError && SAVE_ERROR_COPY[error.message]) {
      toast.error(SAVE_ERROR_COPY[error.message]);
      return;
    }
    showApiError(error);
  }

  async function save() {
    const code = form.code.trim().toUpperCase();
    if (!form.edition_id || !code || !form.applied_message.trim()) {
      toast.error('Edition, code and applied message are required.');
      return;
    }
    const discountValue = Number(form.discount_value);
    if (!Number.isFinite(discountValue) || discountValue <= 0) {
      toast.error('Enter a discount above zero.');
      return;
    }
    if (form.discount_type === 'percent' && discountValue > 100) {
      toast.error('A percentage discount cannot exceed 100.');
      return;
    }
    const minQuantity = Number(form.min_quantity);
    if (!Number.isInteger(minQuantity) || minQuantity < 1) {
      toast.error('Minimum tickets must be a whole number, one or more.');
      return;
    }

    let startsAt: string | null;
    let endsAt: string | null;
    try {
      startsAt = form.starts_at ? istInputToIso(form.starts_at) : null;
      endsAt = form.ends_at ? istInputToIso(form.ends_at) : null;
    } catch {
      toast.error('Use valid IST dates and times.');
      return;
    }
    if (startsAt && endsAt && endsAt <= startsAt) {
      toast.error('End time must be after start time.');
      return;
    }

    setBusy(true);
    const payload = {
      edition_id: form.edition_id,
      code,
      applied_message: form.applied_message.trim(),
      internal_note: form.internal_note.trim() || null,
      discount_type: form.discount_type,
      discount_value: discountValue,
      // A flat code is its own ceiling, so the cap is never sent with one.
      max_discount: form.discount_type === 'percent' && form.max_discount ? Number(form.max_discount) : null,
      scope: form.scope,
      pass_type: form.pass_type || null,
      starts_at: startsAt,
      ends_at: endsAt,
      max_redemptions: form.max_redemptions ? Number(form.max_redemptions) : null,
      max_per_phone: Number(form.max_per_phone) || 1,
      min_quantity: minQuantity,
      is_active: form.is_active,
    };
    try {
      if (isNew) await fetchAdmin('/api/admin/promo-codes', { method: 'POST', body: JSON.stringify(payload) });
      else await fetchAdmin(`/api/admin/promo-codes/${id}`, { method: 'PATCH', body: JSON.stringify(payload) });
      toast.success(isNew ? 'Promo code created' : 'Promo code saved');
      nav('/promos');
    } catch (error) {
      reportSaveError(error);
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!confirm(`Delete ${form.code}? This cannot be undone.`)) return;
    setBusy(true);
    try {
      await fetchAdmin(`/api/admin/promo-codes/${id}`, { method: 'DELETE' });
      toast.success('Promo code deleted');
      nav('/promos');
    } catch (error) {
      if (error instanceof ApiError && error.message === 'promo_code_redeemed') {
        toast.error('This code has already been redeemed. Switch it off instead of deleting it.');
      } else {
        showApiError(error);
      }
    } finally {
      setBusy(false);
    }
  }

  if (!loaded) return null;

  return (
    <Sheet open onOpenChange={(open) => { if (!open) nav('/promos'); }}>
      <SheetContent className="w-full overflow-y-auto p-6 sm:max-w-lg">
        <SheetHeader className="p-0 pr-8">
          <SheetTitle>{isNew ? 'New promo code' : `Edit ${form.code}`}</SheetTitle>
          <SheetDescription>
            Codes work on the public ticket form and on manual registrations. Changes take effect immediately — no site rebuild. All times are IST.
          </SheetDescription>
        </SheetHeader>

        <div className="mt-5 space-y-5">
          <Field label="Edition">
            <select aria-label="Edition" value={form.edition_id} onChange={(event) => set('edition_id', event.target.value)} className="w-full rounded-md border px-3 py-2">
              {editions.map((edition) => <option key={edition.id} value={edition.id}>{edition.slug} · {edition.start_date}</option>)}
            </select>
          </Field>

          <Field label="Code" hint="Letters, digits, hyphens and underscores. Attendees can type it in any case.">
            <input
              aria-label="Code" value={form.code} maxLength={32} spellCheck={false}
              onChange={(event) => set('code', event.target.value.toUpperCase())}
              className="w-full rounded-md border px-3 py-2 font-mono uppercase" placeholder="EARLYBIRD"
            />
          </Field>

          <Field label="Applied message" hint="Shown to the attendee the moment the code is accepted.">
            <textarea
              aria-label="Applied message" value={form.applied_message} maxLength={300} rows={3}
              onChange={(event) => set('applied_message', event.target.value)}
              className="w-full rounded-md border px-3 py-2"
              placeholder="Early bird unlocked — 20% off your whole order."
            />
          </Field>

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Discount type">
              <select
                aria-label="Discount type" value={form.discount_type}
                onChange={(event) => {
                  const next = event.target.value as PromoDiscountType;
                  // Clearing the cap keeps the form from submitting a
                  // combination the database rejects.
                  setForm((current) => ({ ...current, discount_type: next, max_discount: next === 'flat' ? '' : current.max_discount }));
                }}
                className="w-full rounded-md border px-3 py-2"
              >
                <option value="percent">Percentage off</option>
                <option value="flat">Flat ₹ off</option>
              </select>
            </Field>
            <Field label={form.discount_type === 'percent' ? 'Percentage (%)' : 'Amount (₹)'}>
              <input
                aria-label="Discount value" type="number" min="1" step="1"
                max={form.discount_type === 'percent' ? 100 : undefined}
                value={form.discount_value} onChange={(event) => set('discount_value', event.target.value)}
                className="w-full rounded-md border px-3 py-2"
              />
            </Field>
          </div>

          {form.discount_type === 'percent' && (
            <Field label="Maximum discount (₹, optional)" hint="Caps what a percentage can be worth on a large booking.">
              <input
                aria-label="Maximum discount" type="number" min="1" step="1"
                value={form.max_discount} onChange={(event) => set('max_discount', event.target.value)}
                className="w-full rounded-md border px-3 py-2" placeholder="No cap"
              />
            </Field>
          )}

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Applies to">
              <select aria-label="Applies to" value={form.scope} onChange={(event) => set('scope', event.target.value as PromoScope)} className="w-full rounded-md border px-3 py-2">
                <option value="booking">The whole booking</option>
                <option value="first_ticket">The first ticket only</option>
              </select>
            </Field>
            <Field label="Pass restriction">
              <select aria-label="Pass restriction" value={form.pass_type} onChange={(event) => set('pass_type', event.target.value as PassType | '')} className="w-full rounded-md border px-3 py-2">
                <option value="">Either pass</option>
                <option value="oneshot">1-day pass only</option>
                <option value="campaign">2-day pass only</option>
              </select>
            </Field>
          </div>

          <Field
            label="Minimum tickets"
            hint="A bulk discount: the code only applies from this many tickets up. Leave at 1 for a code anyone can use on a single ticket."
          >
            <input
              aria-label="Minimum tickets" type="number" min="1" step="1"
              value={form.min_quantity} onChange={(event) => set('min_quantity', event.target.value)}
              className="w-full rounded-md border px-3 py-2"
            />
          </Field>

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Starts at (IST, optional)">
              <input aria-label="Starts at" type="datetime-local" value={form.starts_at} onChange={(event) => set('starts_at', event.target.value)} className="w-full rounded-md border px-3 py-2" />
            </Field>
            <Field label="Ends at (IST, optional)">
              <input aria-label="Ends at" type="datetime-local" value={form.ends_at} onChange={(event) => set('ends_at', event.target.value)} className="w-full rounded-md border px-3 py-2" />
            </Field>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Total uses (optional)" hint="Blank means unlimited.">
              <input
                aria-label="Total uses" type="number" min="1" step="1"
                value={form.max_redemptions} onChange={(event) => set('max_redemptions', event.target.value)}
                className="w-full rounded-md border px-3 py-2" placeholder="Unlimited"
              />
            </Field>
            <Field label="Uses per person">
              <input
                aria-label="Uses per person" type="number" min="1" step="1"
                value={form.max_per_phone} onChange={(event) => set('max_per_phone', event.target.value)}
                className="w-full rounded-md border px-3 py-2"
              />
            </Field>
          </div>

          <label className="flex items-start gap-3 rounded-md border bg-muted/40 p-3">
            <input aria-label="Active" type="checkbox" checked={form.is_active} onChange={(event) => set('is_active', event.target.checked)} className="mt-1" />
            <span>
              <strong className="block text-sm">Active</strong>
              <span className="text-sm text-muted-foreground">
                Switch this off to retire a code without deleting it — the registrations that used it keep their record.
              </span>
            </span>
          </label>

          {!isNew && (
            <div className="rounded-md border bg-muted/40 p-3 text-sm">
              <strong>{redemptions}</strong> redemption{redemptions === 1 ? '' : 's'} so far.
              <span className="block text-muted-foreground">
                Counted from registrations that are not cancelled, so a cancellation returns the use to the pool.
              </span>
            </div>
          )}

          <button disabled={busy} onClick={save} className="w-full rounded-md bg-primary px-3 py-2 font-medium text-primary-foreground disabled:opacity-50">
            {busy ? 'Saving…' : isNew ? 'Create promo code' : 'Save promo code'}
          </button>

          {!isNew && (
            <button
              disabled={busy || redemptions > 0}
              onClick={remove}
              title={redemptions > 0 ? 'Redeemed codes cannot be deleted. Switch it off instead.' : undefined}
              className="w-full rounded-md border border-destructive px-3 py-2 font-medium text-destructive disabled:opacity-50"
            >
              Delete promo code
            </button>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label>
      <span className="mb-1 block text-sm text-muted-foreground">{label}</span>
      {children}
      {hint && <span className="mt-1.5 block text-xs leading-snug text-muted-foreground">{hint}</span>}
    </label>
  );
}
