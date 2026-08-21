import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { fetchAdmin, showApiError } from '@/lib/api';
import type { Day, EditionRow, PartnerPackageKey, PartnerPricing, PartnerRow, PaymentStatus } from '@/lib/types';

const DEFAULT_PRICING: PartnerPricing = {
  gst_rate: 0.18,
  standard_booth: 8000,
  community_booth: 6500,
  standard_engagement: 3000,
  patron_engagement: 3500,
};

const PACKAGE_LABELS: Record<PartnerPackageKey, string> = {
  standard_booth: 'Standard booth',
  community_booth: 'Community booth',
  standard_engagement: 'Standard engagement',
  patron_engagement: 'Patron engagement',
};

type Form = {
  edition_id: string;
  organization_name: string;
  contact_name: string;
  phone: string;
  email: string;
  website_url: string;
  gstin: string;
  package_key: PartnerPackageKey;
  day: Day;
  details: string;
  internal_notes: string;
  base_amount: string;
  gst_amount: string;
  payment_status: PaymentStatus;
};

const EMPTY: Form = {
  edition_id: '', organization_name: '', contact_name: '', phone: '', email: '', website_url: '', gstin: '',
  package_key: 'standard_booth', day: 'day1', details: '', internal_notes: '', base_amount: '8000', gst_amount: '1440', payment_status: 'pending',
};

function isBooth(packageKey: PartnerPackageKey) {
  return packageKey === 'standard_booth' || packageKey === 'community_booth';
}

function prices(edition: EditionRow | undefined, packageKey: PartnerPackageKey) {
  const pricing = edition?.partner_pricing ?? DEFAULT_PRICING;
  const base = pricing[packageKey];
  return { base, gst: Math.round(base * pricing.gst_rate * 100) / 100 };
}

export default function PartnerDrawer() {
  const navigate = useNavigate();
  const { id } = useParams();
  const [search] = useSearchParams();
  const isNew = !id;
  const [editions, setEditions] = useState<EditionRow[]>([]);
  const [form, setForm] = useState<Form>(EMPTY);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const editionsResult = await fetchAdmin<{ editions: EditionRow[] }>('/api/admin/editions');
        setEditions(editionsResult.editions);
        if (isNew) {
          const requested = search.get('edition_id');
          const edition = editionsResult.editions.find((item) => item.id === requested)
            ?? editionsResult.editions.find((item) => item.is_current)
            ?? editionsResult.editions[0];
          const amount = prices(edition, 'standard_booth');
          setForm((current) => ({ ...current, edition_id: edition?.id ?? '', base_amount: String(amount.base), gst_amount: String(amount.gst) }));
        } else {
          const result = await fetchAdmin<{ partner: PartnerRow }>(`/api/admin/partners/${id}`);
          const partner = result.partner;
          setForm({
            edition_id: partner.edition_id,
            organization_name: partner.organization_name,
            contact_name: partner.contact_name,
            phone: partner.phone,
            email: partner.email,
            website_url: partner.website_url ?? '',
            gstin: partner.gstin ?? '',
            package_key: partner.package_key,
            day: partner.days[0] ?? 'day1',
            details: partner.details ?? '',
            internal_notes: partner.internal_notes ?? '',
            base_amount: String(partner.base_amount),
            gst_amount: String(partner.gst_amount),
            payment_status: partner.payment_status,
          });
        }
        setLoaded(true);
      } catch (error) {
        showApiError(error);
        navigate('/partners');
      }
    })();
  }, [id, isNew, navigate, search]);

  const total = useMemo(() => Number(form.base_amount || 0) + Number(form.gst_amount || 0), [form.base_amount, form.gst_amount]);

  function set<K extends keyof Form>(key: K, value: Form[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function resetPrice(editionId: string, packageKey: PartnerPackageKey) {
    const selectedEdition = editions.find((item) => item.id === editionId);
    const amount = prices(selectedEdition, packageKey);
    setForm((current) => ({ ...current, edition_id: editionId, package_key: packageKey, base_amount: String(amount.base), gst_amount: String(amount.gst) }));
  }

  async function save() {
    if (!form.edition_id || !form.organization_name.trim() || !form.contact_name.trim() || !form.phone.trim() || !form.email.trim()) {
      toast.error('Edition, organisation, contact, phone and email are required.');
      return;
    }
    if (!Number.isFinite(total) || Number(form.base_amount) < 0 || Number(form.gst_amount) < 0) {
      toast.error('Amounts must be non-negative numbers.');
      return;
    }

    setBusy(true);
    const payload = {
      edition_id: form.edition_id,
      organization_name: form.organization_name.trim(),
      contact_name: form.contact_name.trim(),
      phone: form.phone,
      email: form.email.trim(),
      website_url: form.website_url.trim() || null,
      gstin: form.gstin.trim() || null,
      package_key: form.package_key,
      days: isBooth(form.package_key) ? ['day1', 'day2'] : [form.day],
      details: form.details.trim() || null,
      internal_notes: form.internal_notes.trim() || null,
      base_amount: Number(form.base_amount),
      gst_amount: Number(form.gst_amount),
      payment_status: form.payment_status,
    };

    try {
      const result = await fetchAdmin<{ email_sent?: boolean; email_skipped?: 'failed' | null }>(isNew ? '/api/admin/partners' : `/api/admin/partners/${id}`, {
        method: isNew ? 'POST' : 'PATCH',
        body: JSON.stringify(payload),
      });
      if (result.email_skipped === 'failed') toast.warning('Saved, but the confirmation email failed.');
      else if (result.email_sent) toast.success('Partner saved and confirmation emailed');
      else toast.success(isNew ? 'Partner added' : 'Partner saved');
      navigate('/partners');
    } catch (error) {
      showApiError(error);
    } finally {
      setBusy(false);
    }
  }

  if (!loaded) return null;

  return (
    <Sheet open onOpenChange={(open) => { if (!open) navigate('/partners'); }}>
      <SheetContent className="w-full overflow-y-auto p-6 sm:max-w-lg">
        <SheetHeader className="p-0 pr-8">
          <SheetTitle>{isNew ? 'Add partner' : 'Edit partner'}</SheetTitle>
          <SheetDescription>Manage the booking, contact, pricing snapshot and payment status. Confirming a pending purchase sends its confirmation email.</SheetDescription>
        </SheetHeader>

        <div className="mt-5 space-y-4">
          <Field label="Edition"><select aria-label="Edition" value={form.edition_id} onChange={(event) => resetPrice(event.target.value, form.package_key)} className="w-full rounded-md border px-3 py-2">{editions.map((item) => <option key={item.id} value={item.id}>{item.slug} · {item.start_date}</option>)}</select></Field>
          <Field label="Organisation name"><input aria-label="Organisation name" value={form.organization_name} maxLength={160} onChange={(event) => set('organization_name', event.target.value)} className="w-full rounded-md border px-3 py-2" /></Field>
          <Field label="Primary contact"><input aria-label="Primary contact" value={form.contact_name} maxLength={120} onChange={(event) => set('contact_name', event.target.value)} className="w-full rounded-md border px-3 py-2" /></Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Phone"><input aria-label="Phone" inputMode="tel" value={form.phone} onChange={(event) => set('phone', event.target.value)} className="w-full rounded-md border px-3 py-2" /></Field>
            <Field label="Email"><input aria-label="Email" type="email" value={form.email} onChange={(event) => set('email', event.target.value)} className="w-full rounded-md border px-3 py-2" /></Field>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Website or social link"><input aria-label="Website or social link" type="url" placeholder="https://" value={form.website_url} onChange={(event) => set('website_url', event.target.value)} className="w-full rounded-md border px-3 py-2" /></Field>
            <Field label="GSTIN"><input aria-label="GSTIN" value={form.gstin} maxLength={30} onChange={(event) => set('gstin', event.target.value.toUpperCase())} className="w-full rounded-md border px-3 py-2" /></Field>
          </div>

          <Field label="Package"><select aria-label="Package" value={form.package_key} onChange={(event) => resetPrice(form.edition_id, event.target.value as PartnerPackageKey)} className="w-full rounded-md border px-3 py-2">{(Object.keys(PACKAGE_LABELS) as PartnerPackageKey[]).map((key) => <option key={key} value={key}>{PACKAGE_LABELS[key]}</option>)}</select></Field>
          {isBooth(form.package_key) ? (
            <div className="rounded-md border bg-muted p-3 text-sm">Full weekend · day1 + day2</div>
          ) : (
            <Field label="Activity day"><select aria-label="Activity day" value={form.day} onChange={(event) => set('day', event.target.value as Day)} className="w-full rounded-md border px-3 py-2"><option value="day1">day1</option><option value="day2">day2</option></select></Field>
          )}

          <Field label="Public operating detail"><textarea aria-label="Public operating detail" value={form.details} maxLength={2000} rows={4} onChange={(event) => set('details', event.target.value)} className="w-full rounded-md border px-3 py-2" /></Field>
          <Field label="Internal notes"><textarea aria-label="Internal notes" value={form.internal_notes} maxLength={4000} rows={4} onChange={(event) => set('internal_notes', event.target.value)} className="w-full rounded-md border px-3 py-2" /></Field>

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Package amount (before GST)"><input aria-label="Package amount before GST" type="number" min="0" step="0.01" value={form.base_amount} onChange={(event) => set('base_amount', event.target.value)} className="w-full rounded-md border px-3 py-2" /></Field>
            <Field label="GST amount"><input aria-label="GST amount" type="number" min="0" step="0.01" value={form.gst_amount} onChange={(event) => set('gst_amount', event.target.value)} className="w-full rounded-md border px-3 py-2" /></Field>
          </div>
          <div className="flex justify-between rounded-md border bg-muted p-3 font-medium"><span>Total</span><span>₹{total.toLocaleString('en-IN', { maximumFractionDigits: 2 })}</span></div>
          <Field label="Payment status"><select aria-label="Payment status" value={form.payment_status} onChange={(event) => set('payment_status', event.target.value as PaymentStatus)} className="w-full rounded-md border px-3 py-2"><option value="pending">Pending</option><option value="confirmed">Confirmed</option><option value="cancelled">Cancelled</option></select></Field>

          <button disabled={busy} onClick={save} className="w-full rounded-md bg-primary px-3 py-2 font-medium text-primary-foreground disabled:opacity-50">{busy ? 'Saving…' : isNew ? 'Add partner' : 'Save partner'}</button>
        </div>
      </SheetContent>
    </Sheet>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label><span className="mb-1 block text-sm text-muted-foreground">{label}</span>{children}</label>;
}
