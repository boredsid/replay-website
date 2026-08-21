import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { fetchAdmin, showApiError } from '@/lib/api';
import { toast } from 'sonner';
import { oneDayPrice, type EditionRow } from '@/lib/types';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';

type Form = {
  slug: string; name: string; start_date: string; end_date: string; venue: string;
  venue_address: string; google_maps_url: string; entrance_details: string; check_in_location: string;
  nearest_metro_name: string; nearest_metro_distance: string;
  nearest_bus_stop_name: string; nearest_bus_stop_distance: string;
  parking_availability: string; parking_charges: string;
  food_details: string; water_details: string;
  game_library_process: string; help_on_the_day: string;
  daily_start_time: string; daily_end_time: string;
  registration_status: EditionRow['registration_status'];
  is_current: boolean; is_published: boolean;
  oneshot: string;
  caps: Record<string, string>;    // day1..dayN capacity strings
  campaign: string; adventurer_cap: string;
};

const EMPTY: Form = {
  slug: '', name: 'REPLAY', start_date: '', end_date: '', venue: 'TBD',
  venue_address: '', google_maps_url: '', entrance_details: '', check_in_location: '',
  nearest_metro_name: '', nearest_metro_distance: '', nearest_bus_stop_name: '', nearest_bus_stop_distance: '',
  parking_availability: '', parking_charges: '', food_details: '', water_details: '',
  game_library_process: '', help_on_the_day: '',
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
          venue_address: e.venue_address ?? '', google_maps_url: e.google_maps_url ?? '',
          entrance_details: e.entrance_details ?? '', check_in_location: e.check_in_location ?? '',
          nearest_metro_name: e.nearest_metro_name ?? '', nearest_metro_distance: e.nearest_metro_distance ?? '',
          nearest_bus_stop_name: e.nearest_bus_stop_name ?? '', nearest_bus_stop_distance: e.nearest_bus_stop_distance ?? '',
          parking_availability: e.parking_availability ?? '', parking_charges: e.parking_charges ?? '',
          food_details: e.food_details ?? '', water_details: e.water_details ?? '',
          game_library_process: e.game_library_process ?? '', help_on_the_day: e.help_on_the_day ?? '',
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
      venue_address: form.venue_address, google_maps_url: form.google_maps_url,
      entrance_details: form.entrance_details, check_in_location: form.check_in_location,
      nearest_metro_name: form.nearest_metro_name, nearest_metro_distance: form.nearest_metro_distance,
      nearest_bus_stop_name: form.nearest_bus_stop_name, nearest_bus_stop_distance: form.nearest_bus_stop_distance,
      parking_availability: form.parking_availability, parking_charges: form.parking_charges,
      food_details: form.food_details, water_details: form.water_details,
      game_library_process: form.game_library_process, help_on_the_day: form.help_on_the_day,
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

        <div className="border-t pt-3 text-sm font-semibold">Plan your visit</div>
        <p className="text-xs text-muted-foreground">Leave unconfirmed details blank. Saved details appear on the public page after a site rebuild.</p>
        <F label="Venue address">
          <textarea aria-label="Venue address" rows={2} value={form.venue_address} onChange={(e) => set('venue_address', e.target.value)} className="w-full rounded-md border px-3 py-2" />
        </F>
        <F label="Google Maps pin">
          <input aria-label="Google Maps pin" type="url" inputMode="url" placeholder="https://maps.app.goo.gl/…" value={form.google_maps_url} onChange={(e) => set('google_maps_url', e.target.value)} className="w-full rounded-md border px-3 py-2" />
        </F>
        <F label="Entrance details">
          <textarea aria-label="Entrance details" rows={3} value={form.entrance_details} onChange={(e) => set('entrance_details', e.target.value)} className="w-full rounded-md border px-3 py-2" />
        </F>
        <F label="Check-in location">
          <textarea aria-label="Check-in location" rows={2} value={form.check_in_location} onChange={(e) => set('check_in_location', e.target.value)} className="w-full rounded-md border px-3 py-2" />
        </F>
        <div className="grid gap-2 sm:grid-cols-2">
          <F label="Nearest Metro station">
            <input aria-label="Nearest Metro station" value={form.nearest_metro_name} onChange={(e) => set('nearest_metro_name', e.target.value)} className="w-full rounded-md border px-3 py-2" />
          </F>
          <F label="Metro distance">
            <input aria-label="Metro distance" placeholder="e.g. 700 m" value={form.nearest_metro_distance} onChange={(e) => set('nearest_metro_distance', e.target.value)} className="w-full rounded-md border px-3 py-2" />
          </F>
        </div>
        <div className="grid gap-2 sm:grid-cols-2">
          <F label="Nearest bus stop">
            <input aria-label="Nearest bus stop" value={form.nearest_bus_stop_name} onChange={(e) => set('nearest_bus_stop_name', e.target.value)} className="w-full rounded-md border px-3 py-2" />
          </F>
          <F label="Bus stop distance">
            <input aria-label="Bus stop distance" placeholder="e.g. 300 m" value={form.nearest_bus_stop_distance} onChange={(e) => set('nearest_bus_stop_distance', e.target.value)} className="w-full rounded-md border px-3 py-2" />
          </F>
        </div>
        <F label="Parking availability">
          <textarea aria-label="Parking availability" rows={2} value={form.parking_availability} onChange={(e) => set('parking_availability', e.target.value)} className="w-full rounded-md border px-3 py-2" />
        </F>
        <F label="Parking charges">
          <textarea aria-label="Parking charges" rows={2} value={form.parking_charges} onChange={(e) => set('parking_charges', e.target.value)} className="w-full rounded-md border px-3 py-2" />
        </F>
        <F label="Food details">
          <textarea aria-label="Food details" rows={3} value={form.food_details} onChange={(e) => set('food_details', e.target.value)} className="w-full rounded-md border px-3 py-2" />
        </F>
        <F label="Water details">
          <textarea aria-label="Water details" rows={2} value={form.water_details} onChange={(e) => set('water_details', e.target.value)} className="w-full rounded-md border px-3 py-2" />
        </F>
        <F label="Game library process">
          <textarea aria-label="Game library process" rows={4} value={form.game_library_process} onChange={(e) => set('game_library_process', e.target.value)} className="w-full rounded-md border px-3 py-2" />
        </F>
        <F label="Help on the day">
          <textarea aria-label="Help on the day" rows={3} value={form.help_on_the_day} onChange={(e) => set('help_on_the_day', e.target.value)} className="w-full rounded-md border px-3 py-2" />
        </F>

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
