import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import { StatusBadge } from '@/components/StatusBadge';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { fetchAdmin, showApiError } from '@/lib/api';
import { PARTNER_OFFERS, isSingleDay, offerAmounts } from '@/lib/partner-offers';
import type { Day, EditionRow, PartnerOfferKey, PartnerRow, PartnerStage, PaymentStatus } from '@/lib/types';

type Form = {
  edition_id: string;
  organization_name: string;
  contact_name: string;
  phone: string;
  email: string;
  website_url: string;
  gstin: string;
  package_key: PartnerOfferKey;
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

function formatMoment(value: string | null): string {
  if (!value) return '—';
  return new Date(value).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });
}

export default function PartnerDrawer() {
  const navigate = useNavigate();
  const { id } = useParams();
  const [search] = useSearchParams();
  const isNew = !id;
  const [editions, setEditions] = useState<EditionRow[]>([]);
  const [form, setForm] = useState<Form>(EMPTY);
  const [partner, setPartner] = useState<PartnerRow | null>(null);
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
          const amount = offerAmounts(edition, 'standard_booth');
          setForm((current) => ({ ...current, edition_id: edition?.id ?? '', base_amount: String(amount.base), gst_amount: String(amount.gst) }));
        } else {
          const result = await fetchAdmin<{ partner: PartnerRow }>(`/api/admin/partners/${id}`);
          const loadedPartner = result.partner;
          setPartner(loadedPartner);
          setForm({
            edition_id: loadedPartner.edition_id,
            organization_name: loadedPartner.organization_name,
            contact_name: loadedPartner.contact_name ?? '',
            phone: loadedPartner.phone ?? '',
            email: loadedPartner.email ?? '',
            website_url: loadedPartner.website_url ?? '',
            gstin: loadedPartner.gstin ?? '',
            package_key: loadedPartner.package_key,
            day: loadedPartner.days[0] ?? 'day1',
            details: loadedPartner.details ?? '',
            internal_notes: loadedPartner.internal_notes ?? '',
            base_amount: String(loadedPartner.base_amount),
            gst_amount: String(loadedPartner.gst_amount),
            payment_status: loadedPartner.payment_status,
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
  const stage: PartnerStage | null = partner?.stage ?? null;
  const isLead = stage === 'lead';

  function set<K extends keyof Form>(key: K, value: Form[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function resetPrice(editionId: string, packageKey: PartnerOfferKey) {
    const amount = offerAmounts(editions.find((item) => item.id === editionId), packageKey);
    setForm((current) => ({ ...current, edition_id: editionId, package_key: packageKey, base_amount: String(amount.base), gst_amount: String(amount.gst) }));
  }

  async function copyLink() {
    if (!partner?.invite_url) return;
    try {
      await navigator.clipboard.writeText(partner.invite_url);
      toast.success('Link copied');
    } catch {
      toast.error('Copy failed — select the link and copy it by hand.');
    }
  }

  async function save() {
    if (!form.edition_id || !form.organization_name.trim()) {
      toast.error('Edition and organisation are required.');
      return;
    }
    // A lead has not met its partner yet, so it is allowed to be blank. Filling
    // all three contact fields here promotes it to prospective.
    if (!isLead && (!form.contact_name.trim() || !form.phone.trim() || !form.email.trim())) {
      toast.error('Contact, phone and email are required.');
      return;
    }
    if (!Number.isFinite(total) || Number(form.base_amount) < 0 || Number(form.gst_amount) < 0) {
      toast.error('Amounts must be non-negative numbers.');
      return;
    }

    setBusy(true);
    const hasContact = Boolean(form.contact_name.trim() && form.phone.trim() && form.email.trim());
    const singleDay = isSingleDay(form.package_key);
    const payload = {
      edition_id: form.edition_id,
      organization_name: form.organization_name.trim(),
      contact_name: form.contact_name.trim() || null,
      phone: form.phone.trim() || null,
      email: form.email.trim() || null,
      website_url: form.website_url.trim() || null,
      gstin: form.gstin.trim() || null,
      package_key: form.package_key,
      // A lead's days stay empty until it has a partner behind it, so the row
      // never claims a day nobody has agreed to.
      days: singleDay ? (isLead && !hasContact ? [] : [form.day]) : ['day1', 'day2'],
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

        {partner && (
          <div className="mt-5 space-y-3 rounded-md border bg-muted p-3 text-sm">
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Stage</span>
              <StatusBadge status={partner.stage} />
            </div>
            <div className="flex justify-between"><span className="text-muted-foreground">Form filled</span><span>{formatMoment(partner.submitted_at)}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Payment claimed</span><span>{formatMoment(partner.payment_claimed_at)}</span></div>
            {partner.invite_url && (
              <div className="space-y-2 border-t pt-3">
                <div className="text-muted-foreground">Partner link{partner.invite_expires_at ? ` · expires ${formatMoment(partner.invite_expires_at)}` : ''}</div>
                <div className="break-all font-mono text-xs">{partner.invite_url}</div>
                <button onClick={copyLink} className="w-full rounded-md border bg-background px-3 py-2 text-sm">Copy link</button>
              </div>
            )}
          </div>
        )}

        <div className="mt-5 space-y-4">
          <Field label="Edition"><select aria-label="Edition" value={form.edition_id} onChange={(event) => resetPrice(event.target.value, form.package_key)} className="w-full rounded-md border px-3 py-2">{editions.map((item) => <option key={item.id} value={item.id}>{item.slug} · {item.start_date}</option>)}</select></Field>
          <Field label="Organisation name"><input aria-label="Organisation name" value={form.organization_name} maxLength={160} onChange={(event) => set('organization_name', event.target.value)} className="w-full rounded-md border px-3 py-2" /></Field>
          <Field label={isLead ? 'Primary contact (the partner fills this in)' : 'Primary contact'}><input aria-label="Primary contact" value={form.contact_name} maxLength={120} onChange={(event) => set('contact_name', event.target.value)} className="w-full rounded-md border px-3 py-2" /></Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Phone"><input aria-label="Phone" inputMode="tel" value={form.phone} onChange={(event) => set('phone', event.target.value)} className="w-full rounded-md border px-3 py-2" /></Field>
            <Field label="Email"><input aria-label="Email" type="email" value={form.email} onChange={(event) => set('email', event.target.value)} className="w-full rounded-md border px-3 py-2" /></Field>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Website or social link"><input aria-label="Website or social link" type="url" placeholder="https://" value={form.website_url} onChange={(event) => set('website_url', event.target.value)} className="w-full rounded-md border px-3 py-2" /></Field>
            <Field label="GSTIN"><input aria-label="GSTIN" value={form.gstin} maxLength={30} onChange={(event) => set('gstin', event.target.value.toUpperCase())} className="w-full rounded-md border px-3 py-2" /></Field>
          </div>

          <Field label="Partner type"><select aria-label="Partner type" value={form.package_key} onChange={(event) => resetPrice(form.edition_id, event.target.value as PartnerOfferKey)} className="w-full rounded-md border px-3 py-2">{PARTNER_OFFERS.map((offer) => <option key={offer.key} value={offer.key}>{offer.label}</option>)}</select></Field>
          {isSingleDay(form.package_key) ? (
            <Field label="Activity day"><select aria-label="Activity day" value={form.day} onChange={(event) => set('day', event.target.value as Day)} className="w-full rounded-md border px-3 py-2"><option value="day1">day1</option><option value="day2">day2</option></select></Field>
          ) : (
            <div className="rounded-md border bg-muted p-3 text-sm">Full weekend · day1 + day2</div>
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
