import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { fetchAdmin, showApiError } from '@/lib/api';
import { PARTNER_OFFERS, isSingleDay, offerAmounts } from '@/lib/partner-offers';
import type { Day, EditionRow, PartnerOfferKey, PartnerRow } from '@/lib/types';

type Form = {
  edition_id: string;
  organization_name: string;
  package_key: PartnerOfferKey;
  day: Day;
  base_amount: string;
  gst_amount: string;
  expires_at: string;
  internal_notes: string;
};

const EMPTY: Form = {
  edition_id: '',
  organization_name: '',
  package_key: 'standard_booth',
  day: 'day1',
  base_amount: '8000',
  gst_amount: '1440',
  expires_at: '',
  internal_notes: '',
};

export default function PartnerInviteDrawer() {
  const navigate = useNavigate();
  const [search] = useSearchParams();
  const [editions, setEditions] = useState<EditionRow[]>([]);
  const [form, setForm] = useState<Form>(EMPTY);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState<{ partner: PartnerRow; url: string } | null>(null);

  useEffect(() => {
    fetchAdmin<{ editions: EditionRow[] }>('/api/admin/editions')
      .then(({ editions: items }) => {
        setEditions(items);
        const requested = search.get('edition_id');
        const edition = items.find((item) => item.id === requested)
          ?? items.find((item) => item.is_current)
          ?? items[0];
        const amounts = offerAmounts(edition, 'standard_booth');
        setForm((current) => ({
          ...current,
          edition_id: edition?.id ?? '',
          base_amount: String(amounts.base),
          gst_amount: String(amounts.gst),
        }));
        setLoaded(true);
      })
      .catch((error) => { showApiError(error); navigate('/partners'); });
  }, [navigate, search]);

  const total = useMemo(
    () => Number(form.base_amount || 0) + Number(form.gst_amount || 0),
    [form.base_amount, form.gst_amount],
  );

  function set<K extends keyof Form>(key: K, value: Form[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function resetPrice(editionId: string, packageKey: PartnerOfferKey) {
    const amounts = offerAmounts(editions.find((item) => item.id === editionId), packageKey);
    setForm((current) => ({
      ...current,
      edition_id: editionId,
      package_key: packageKey,
      base_amount: String(amounts.base),
      gst_amount: String(amounts.gst),
    }));
  }

  async function createLink() {
    if (!form.edition_id || !form.organization_name.trim()) {
      toast.error('Edition and partner name are required.');
      return;
    }
    if (!Number.isFinite(total) || Number(form.base_amount) < 0 || Number(form.gst_amount) < 0) {
      toast.error('Amounts must be non-negative numbers.');
      return;
    }

    setBusy(true);
    try {
      const result = await fetchAdmin<{ partner: PartnerRow; invite_url: string }>('/api/admin/partners/invites', {
        method: 'POST',
        body: JSON.stringify({
          edition_id: form.edition_id,
          organization_name: form.organization_name.trim(),
          package_key: form.package_key,
          ...(isSingleDay(form.package_key) ? { day: form.day } : {}),
          base_amount: Number(form.base_amount),
          gst_amount: Number(form.gst_amount),
          internal_notes: form.internal_notes.trim() || null,
          expires_at: form.expires_at ? new Date(`${form.expires_at}T23:59:59`).toISOString() : null,
        }),
      });
      setCreated({ partner: result.partner, url: result.invite_url });
      toast.success('Partner link created');
    } catch (error) {
      showApiError(error);
    } finally {
      setBusy(false);
    }
  }

  async function copyLink(url: string) {
    try {
      await navigator.clipboard.writeText(url);
      toast.success('Link copied');
    } catch {
      toast.error('Copy failed — select the link and copy it by hand.');
    }
  }

  if (!loaded) return null;

  return (
    <Sheet open onOpenChange={(open) => { if (!open) navigate('/partners'); }}>
      <SheetContent className="w-full overflow-y-auto p-6 sm:max-w-lg">
        <SheetHeader className="p-0 pr-8">
          <SheetTitle>{created ? 'Send this link' : 'Create partner link'}</SheetTitle>
          <SheetDescription>
            {created
              ? 'The partner fills in their own details and pays by UPI. They stay a lead until they do.'
              : 'Name the partner, pick what they are buying and what it costs. The link carries that price — the partner cannot change it.'}
          </SheetDescription>
        </SheetHeader>

        {created ? (
          <div className="mt-5 space-y-4">
            <div className="rounded-md border bg-muted p-3">
              <div className="text-sm text-muted-foreground">Link for {created.partner.organization_name}</div>
              <div className="mt-1 break-all font-mono text-sm">{created.url}</div>
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              <button onClick={() => copyLink(created.url)} className="rounded-md bg-primary px-3 py-2 font-medium text-primary-foreground">Copy link</button>
              <a
                href={`https://wa.me/?text=${encodeURIComponent(`Hi! Here is your REPLAY partner link for ${created.partner.organization_name}: ${created.url}`)}`}
                target="_blank"
                rel="noopener noreferrer"
                className="rounded-md border px-3 py-2 text-center font-medium"
              >
                Share on WhatsApp
              </a>
            </div>
            <button onClick={() => navigate(`/partners/${created.partner.id}`)} className="w-full rounded-md border px-3 py-2 font-medium">Open the partner record</button>
            <button onClick={() => navigate('/partners')} className="w-full rounded-md px-3 py-2 text-sm text-muted-foreground">Back to partners</button>
          </div>
        ) : (
          <div className="mt-5 space-y-4">
            <Field label="Edition">
              <select aria-label="Edition" value={form.edition_id} onChange={(event) => resetPrice(event.target.value, form.package_key)} className="w-full rounded-md border px-3 py-2">
                {editions.map((item) => <option key={item.id} value={item.id}>{item.slug} · {item.start_date}</option>)}
              </select>
            </Field>
            <Field label="Partner name">
              <input aria-label="Partner name" value={form.organization_name} maxLength={160} onChange={(event) => set('organization_name', event.target.value)} className="w-full rounded-md border px-3 py-2" />
            </Field>
            <Field label="Partner type">
              <select aria-label="Partner type" value={form.package_key} onChange={(event) => resetPrice(form.edition_id, event.target.value as PartnerOfferKey)} className="w-full rounded-md border px-3 py-2">
                {PARTNER_OFFERS.map((offer) => <option key={offer.key} value={offer.key}>{offer.label}</option>)}
              </select>
            </Field>
            {isSingleDay(form.package_key) ? (
              <Field label="Activity day (the partner can change this)">
                <select aria-label="Activity day" value={form.day} onChange={(event) => set('day', event.target.value as Day)} className="w-full rounded-md border px-3 py-2">
                  <option value="day1">day1</option>
                  <option value="day2">day2</option>
                </select>
              </Field>
            ) : (
              <div className="rounded-md border bg-muted p-3 text-sm">Full weekend · day1 + day2</div>
            )}

            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Amount (before GST)">
                <input aria-label="Amount before GST" type="number" min="0" step="0.01" value={form.base_amount} onChange={(event) => set('base_amount', event.target.value)} className="w-full rounded-md border px-3 py-2" />
              </Field>
              <Field label="GST amount">
                <input aria-label="GST amount" type="number" min="0" step="0.01" value={form.gst_amount} onChange={(event) => set('gst_amount', event.target.value)} className="w-full rounded-md border px-3 py-2" />
              </Field>
            </div>
            <div className="flex justify-between rounded-md border bg-muted p-3 font-medium">
              <span>Partner pays</span>
              <span>₹{total.toLocaleString('en-IN', { maximumFractionDigits: 2 })}</span>
            </div>

            <Field label="Link expires (optional)">
              <input aria-label="Link expires" type="date" value={form.expires_at} onChange={(event) => set('expires_at', event.target.value)} className="w-full rounded-md border px-3 py-2" />
            </Field>
            <Field label="Internal notes">
              <textarea aria-label="Internal notes" value={form.internal_notes} maxLength={4000} rows={3} onChange={(event) => set('internal_notes', event.target.value)} className="w-full rounded-md border px-3 py-2" />
            </Field>

            <button disabled={busy} onClick={createLink} className="w-full rounded-md bg-primary px-3 py-2 font-medium text-primary-foreground disabled:opacity-50">
              {busy ? 'Creating…' : 'Create link'}
            </button>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label><span className="mb-1 block text-sm text-muted-foreground">{label}</span>{children}</label>;
}
