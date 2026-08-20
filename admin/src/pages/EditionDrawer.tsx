import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { fetchAdmin, showApiError } from '@/lib/api';
import { toast } from 'sonner';
import { oneDayPrice, type EditionRow } from '@/lib/types';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';

type Form = {
  slug: string; name: string; start_date: string; end_date: string; venue: string;
  daily_start_time: string; daily_end_time: string;
  registration_status: EditionRow['registration_status'];
  is_current: boolean; is_published: boolean;
  oneshot: string;
  caps: Record<string, string>;    // day1..dayN capacity strings
  campaign: string; adventurer_cap: string;
};

const EMPTY: Form = {
  slug: '', name: 'REPLAY', start_date: '', end_date: '', venue: 'TBD',
  daily_start_time: '10:00', daily_end_time: '19:00',
  registration_status: 'upcoming', is_current: false, is_published: false,
  oneshot: '700', caps: { day1: '250' }, campaign: '1200', adventurer_cap: '1000',
};

// Inclusive day span between two ISO dates; falls back to 1 when dates are unset/invalid.
function daySpan(start: string, end: string): number {
  if (!start || !end) return 1;
  const s = Date.parse(start + 'T00:00:00Z');
  const e = Date.parse(end + 'T00:00:00Z');
  if (Number.isNaN(s) || Number.isNaN(e) || e < s) return 1;
  return Math.floor((e - s) / 86400000) + 1;
}

export default function EditionDrawer() {
  const nav = useNavigate();
  const { id } = useParams();
  const isNew = !id;
  const [form, setForm] = useState<Form>(EMPTY);
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(isNew);
  const [showRebuild, setShowRebuild] = useState(false);
  const [rebuilding, setRebuilding] = useState(false);

  useEffect(() => {
    if (isNew) return;
    setLoaded(false);
    (async () => {
      try {
        const res = await fetchAdmin<{ editions: EditionRow[] }>('/api/admin/editions');
        const e = res.editions.find((x) => x.id === id);
        if (!e) { toast.error('Edition not found'); nav('/editions'); return; }
        const caps: Record<string, string> = {};
        for (const [k, v] of Object.entries(e.capacity_per_day)) caps[k] = String(v);
        setForm({
          slug: e.slug, name: e.name, start_date: e.start_date, end_date: e.end_date, venue: e.venue,
          daily_start_time: e.daily_start_time?.slice(0, 5) ?? '10:00', daily_end_time: e.daily_end_time?.slice(0, 5) ?? '19:00',
          registration_status: e.registration_status, is_current: e.is_current, is_published: e.is_published,
          oneshot: String(oneDayPrice(e.pricing)), caps,
          campaign: e.pricing.campaign == null ? '' : String(e.pricing.campaign),
          adventurer_cap: String(e.pricing.adventurer_cap),
        });
        setLoaded(true);
      } catch (e) { showApiError(e); }
    })();
  }, [id, isNew, nav]);

  function set<K extends keyof Form>(k: K, v: Form[K]) { setForm((f) => ({ ...f, [k]: v })); }
  function setDayCap(key: string, v: string) { setForm((f) => ({ ...f, caps: { ...f.caps, [key]: v } })); }

  const dayCount = daySpan(form.start_date, form.end_date);
  const dayKeys = useMemo(() => Array.from({ length: dayCount }, (_, i) => `day${i + 1}`), [dayCount]);
  const isMultiDay = dayCount >= 2;

  async function save() {
    if (form.registration_status !== 'closed' && dayCount !== 2) {
      toast.error('Active editions must span exactly two consecutive days.');
      return;
    }
    setBusy(true);
    const capacity: Record<string, number> = {};
    for (const k of dayKeys) capacity[k] = Number(form.caps[k] ?? '');
    const payload = {
      slug: form.slug.trim(), name: form.name, start_date: form.start_date, end_date: form.end_date, venue: form.venue,
      daily_start_time: form.daily_start_time, daily_end_time: form.daily_end_time,
      registration_status: form.registration_status, is_current: form.is_current, is_published: form.is_published,
      pricing: { oneshot: Number(form.oneshot), campaign: isMultiDay ? Number(form.campaign) : null, adventurer_cap: Number(form.adventurer_cap) },
      capacity_per_day: capacity,
    };
    try {
      if (isNew) await fetchAdmin('/api/admin/editions', { method: 'POST', body: JSON.stringify(payload) });
      else await fetchAdmin(`/api/admin/editions/${id}`, { method: 'PATCH', body: JSON.stringify(payload) });
      toast.success(isNew ? 'Edition created' : 'Edition saved');
      setShowRebuild(true);
    } catch (e) { showApiError(e); } finally { setBusy(false); }
  }

  async function doRebuild() {
    setRebuilding(true);
    try {
      await fetchAdmin('/api/admin/rebuild', { method: 'POST' });
      toast.success('Site rebuilding… (~60s)');
    } catch (e) {
      showApiError(e, 'Saved, but rebuild failed — try the Rebuild button later.');
    } finally {
      setRebuilding(false);
      setShowRebuild(false);
      nav('/editions');
    }
  }

  if (!loaded) return null;

  return (
    <Sheet open onOpenChange={(open) => { if (!open && !showRebuild) nav('/editions'); }}>
      <SheetContent className="w-full overflow-y-auto p-6 sm:max-w-md">
        <SheetHeader className="p-0 pr-8">
          <SheetTitle>{isNew ? 'New edition' : 'Edit edition'}</SheetTitle>
          <SheetDescription>Active editions must cover exactly two consecutive days.</SheetDescription>
        </SheetHeader>
        <div className="space-y-3">
        <F label="Slug"><input aria-label="Slug" value={form.slug} onChange={(e) => set('slug', e.target.value)} className="w-full rounded-md border px-3 py-2" /></F>
        <F label="Name"><input aria-label="Name" value={form.name} onChange={(e) => set('name', e.target.value)} className="w-full rounded-md border px-3 py-2" /></F>
        <F label="Start date"><input aria-label="Start date" type="date" value={form.start_date} onChange={(e) => set('start_date', e.target.value)} className="w-full rounded-md border px-3 py-2" /></F>
        <F label="End date"><input aria-label="End date" type="date" value={form.end_date} onChange={(e) => set('end_date', e.target.value)} className="w-full rounded-md border px-3 py-2" /></F>
        <div className="grid grid-cols-2 gap-2">
          <F label="Daily start time"><input aria-label="Daily start time" type="time" value={form.daily_start_time} onChange={(e) => set('daily_start_time', e.target.value)} className="w-full rounded-md border px-3 py-2" /></F>
          <F label="Daily end time"><input aria-label="Daily end time" type="time" value={form.daily_end_time} onChange={(e) => set('daily_end_time', e.target.value)} className="w-full rounded-md border px-3 py-2" /></F>
        </div>
        <div className="text-xs text-muted-foreground">
          {dayCount} day{dayCount === 1 ? '' : 's'}{form.registration_status !== 'closed' && dayCount !== 2 ? ' — active editions require exactly 2.' : ''}
        </div>
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

        <div className="border-t pt-3 text-sm font-semibold">Pass prices (₹)</div>
        <F label="One-day pass price">
          <input aria-label="One-day pass price" type="number" value={form.oneshot} onChange={(e) => set('oneshot', e.target.value)} className="w-full rounded-md border px-3 py-2" />
        </F>
        {isMultiDay && (
          <F label="Two-day pass price">
            <input aria-label="Two-day pass price" type="number" value={form.campaign} onChange={(e) => set('campaign', e.target.value)} className="w-full rounded-md border px-3 py-2" />
          </F>
        )}
        <F label="Adventurer cap"><input aria-label="Adventurer cap" type="number" value={form.adventurer_cap} onChange={(e) => set('adventurer_cap', e.target.value)} className="w-full rounded-md border px-3 py-2" /></F>

        <div className="border-t pt-3 text-sm font-semibold">Capacity / day</div>
        <div className="grid grid-cols-2 gap-2">
          {dayKeys.map((k, i) => (
            <F key={k} label={`Day ${i + 1} capacity`}>
              <input aria-label={`Day ${i + 1} capacity`} type="number" value={form.caps[k] ?? ''} onChange={(e) => setDayCap(k, e.target.value)} className="w-full rounded-md border px-3 py-2" />
            </F>
          ))}
        </div>
        <button disabled={busy || (form.registration_status !== 'closed' && dayCount !== 2)} onClick={save} className="w-full rounded-md bg-primary px-3 py-2 font-medium text-primary-foreground disabled:opacity-50">
          {busy ? 'Saving…' : isNew ? 'Create edition' : 'Save edition'}
        </button>
        </div>

      <Dialog open={showRebuild} onOpenChange={(o) => { if (!o) { setShowRebuild(false); nav('/editions'); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Rebuild the site?</DialogTitle>
            <DialogDescription>
              Edition changes are baked into the public site at build time. Rebuild now to publish them (~60s), or do it later from the Rebuild button.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <button
              onClick={() => { setShowRebuild(false); nav('/editions'); }}
              className="w-full rounded-md border px-3 py-2 text-sm sm:w-auto"
            >
              Do later
            </button>
            <button
              disabled={rebuilding}
              onClick={doRebuild}
              className="w-full rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50 sm:w-auto"
            >
              {rebuilding ? 'Rebuilding…' : 'Rebuild now'}
            </button>
          </DialogFooter>
        </DialogContent>
        </Dialog>
      </SheetContent>
    </Sheet>
  );
}

function F({ label, children }: { label: string; children: React.ReactNode }) {
  return (<div><div className="mb-1 text-sm text-muted-foreground">{label}</div>{children}</div>);
}
