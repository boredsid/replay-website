import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { fetchAdmin, showApiError } from '@/lib/api';
import { toast } from 'sonner';
import type { EditionRow } from '@/lib/types';

type Form = {
  slug: string; name: string; start_date: string; end_date: string; venue: string;
  registration_status: EditionRow['registration_status'];
  is_current: boolean; is_published: boolean;
  oneshot_day1: string; oneshot_day2: string; campaign: string; adventurer_cap: string;
  cap_day1: string; cap_day2: string;
};

const EMPTY: Form = {
  slug: '', name: 'REPLAY', start_date: '', end_date: '', venue: 'TBD',
  registration_status: 'upcoming', is_current: false, is_published: false,
  oneshot_day1: '800', oneshot_day2: '800', campaign: '1400', adventurer_cap: '1000',
  cap_day1: '250', cap_day2: '250',
};

export default function EditionDrawer() {
  const nav = useNavigate();
  const { id } = useParams();
  const isNew = !id;
  const [form, setForm] = useState<Form>(EMPTY);
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(isNew);

  useEffect(() => {
    if (isNew) return;
    setLoaded(false);
    (async () => {
      try {
        const res = await fetchAdmin<{ editions: EditionRow[] }>('/api/admin/editions');
        const e = res.editions.find((x) => x.id === id);
        if (!e) { toast.error('Edition not found'); nav('/editions'); return; }
        setForm({
          slug: e.slug, name: e.name, start_date: e.start_date, end_date: e.end_date, venue: e.venue,
          registration_status: e.registration_status, is_current: e.is_current, is_published: e.is_published,
          oneshot_day1: String(e.pricing.oneshot.day1), oneshot_day2: String(e.pricing.oneshot.day2),
          campaign: String(e.pricing.campaign), adventurer_cap: String(e.pricing.adventurer_cap),
          cap_day1: String(e.capacity_per_day.day1), cap_day2: String(e.capacity_per_day.day2),
        });
        setLoaded(true);
      } catch (e) { showApiError(e); }
    })();
  }, [id, isNew, nav]);

  function set<K extends keyof Form>(k: K, v: Form[K]) { setForm((f) => ({ ...f, [k]: v })); }

  async function save() {
    setBusy(true);
    const payload = {
      slug: form.slug.trim(), name: form.name, start_date: form.start_date, end_date: form.end_date, venue: form.venue,
      registration_status: form.registration_status, is_current: form.is_current, is_published: form.is_published,
      pricing: {
        oneshot: { day1: Number(form.oneshot_day1), day2: Number(form.oneshot_day2) },
        campaign: Number(form.campaign), adventurer_cap: Number(form.adventurer_cap),
      },
      capacity_per_day: { day1: Number(form.cap_day1), day2: Number(form.cap_day2) },
    };
    try {
      if (isNew) await fetchAdmin('/api/admin/editions', { method: 'POST', body: JSON.stringify(payload) });
      else await fetchAdmin(`/api/admin/editions/${id}`, { method: 'PATCH', body: JSON.stringify(payload) });
      toast.success(isNew ? 'Edition created' : 'Edition saved');
      if (confirm('Rebuild the public site now? (edition changes are baked in at build time, ~60s)')) {
        try { await fetchAdmin('/api/admin/rebuild', { method: 'POST' }); toast.success('Site rebuilding…'); }
        catch (e) { showApiError(e, 'Saved, but rebuild failed — use the Rebuild button.'); }
      }
      nav('/editions');
    } catch (e) { showApiError(e); } finally { setBusy(false); }
  }

  if (!loaded) return null;

  return (
    <div className="fixed inset-y-0 right-0 z-50 w-full max-w-md overflow-y-auto border-l bg-background p-6 shadow-xl">
      <button onClick={() => nav('/editions')} className="mb-4 text-sm text-muted-foreground">← Close</button>
      <h2 className="mb-4 text-xl font-bold">{isNew ? 'New edition' : 'Edit edition'}</h2>
      <div className="space-y-3">
        <F label="Slug"><input aria-label="Slug" value={form.slug} onChange={(e) => set('slug', e.target.value)} className="w-full rounded-md border px-3 py-2" /></F>
        <F label="Name"><input aria-label="Name" value={form.name} onChange={(e) => set('name', e.target.value)} className="w-full rounded-md border px-3 py-2" /></F>
        <F label="Start date"><input aria-label="Start date" type="date" value={form.start_date} onChange={(e) => set('start_date', e.target.value)} className="w-full rounded-md border px-3 py-2" /></F>
        <F label="End date"><input aria-label="End date" type="date" value={form.end_date} onChange={(e) => set('end_date', e.target.value)} className="w-full rounded-md border px-3 py-2" /></F>
        <F label="Venue"><input aria-label="Venue" value={form.venue} onChange={(e) => set('venue', e.target.value)} className="w-full rounded-md border px-3 py-2" /></F>
        <F label="Registration status">
          <select aria-label="Registration status" value={form.registration_status} onChange={(e) => set('registration_status', e.target.value as Form['registration_status'])} className="w-full rounded-md border px-3 py-2">
            <option value="upcoming">upcoming</option>
            <option value="open">open</option>
            <option value="sold_out">sold_out</option>
            <option value="closed">closed</option>
          </select>
        </F>
        <label className="flex items-center gap-2"><input type="checkbox" checked={form.is_current} onChange={(e) => set('is_current', e.target.checked)} /> Current edition</label>
        <label className="flex items-center gap-2"><input type="checkbox" checked={form.is_published} onChange={(e) => set('is_published', e.target.checked)} /> Published</label>
        <div className="border-t pt-3 text-sm font-semibold">Pricing (₹)</div>
        <div className="grid grid-cols-2 gap-2">
          <F label="Oneshot Sat"><input aria-label="Oneshot Sat" type="number" value={form.oneshot_day1} onChange={(e) => set('oneshot_day1', e.target.value)} className="w-full rounded-md border px-3 py-2" /></F>
          <F label="Oneshot Sun"><input aria-label="Oneshot Sun" type="number" value={form.oneshot_day2} onChange={(e) => set('oneshot_day2', e.target.value)} className="w-full rounded-md border px-3 py-2" /></F>
          <F label="Campaign"><input aria-label="Campaign" type="number" value={form.campaign} onChange={(e) => set('campaign', e.target.value)} className="w-full rounded-md border px-3 py-2" /></F>
          <F label="Adventurer cap"><input aria-label="Adventurer cap" type="number" value={form.adventurer_cap} onChange={(e) => set('adventurer_cap', e.target.value)} className="w-full rounded-md border px-3 py-2" /></F>
        </div>
        <div className="border-t pt-3 text-sm font-semibold">Capacity / day</div>
        <div className="grid grid-cols-2 gap-2">
          <F label="Capacity Sat"><input aria-label="Capacity Sat" type="number" value={form.cap_day1} onChange={(e) => set('cap_day1', e.target.value)} className="w-full rounded-md border px-3 py-2" /></F>
          <F label="Capacity Sun"><input aria-label="Capacity Sun" type="number" value={form.cap_day2} onChange={(e) => set('cap_day2', e.target.value)} className="w-full rounded-md border px-3 py-2" /></F>
        </div>
        <button disabled={busy} onClick={save} className="w-full rounded-md bg-primary px-3 py-2 font-medium text-primary-foreground disabled:opacity-50">
          {busy ? 'Saving…' : isNew ? 'Create edition' : 'Save edition'}
        </button>
      </div>
    </div>
  );
}

function F({ label, children }: { label: string; children: React.ReactNode }) {
  return (<div><div className="mb-1 text-sm text-muted-foreground">{label}</div>{children}</div>);
}
