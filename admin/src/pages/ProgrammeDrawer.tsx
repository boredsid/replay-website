import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import { fetchAdmin, showApiError } from '@/lib/api';
import type { EditionRow, ScheduleItemRow, ScheduleKind, SchedulePublicStatus, ScheduleSection, ScheduleSignupMode } from '@/lib/types';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';

type Form = {
  edition_id: string;
  day: string;
  title: string;
  section: ScheduleSection;
  kind: ScheduleKind;
  is_all_day: boolean;
  start_time: string;
  end_time: string;
  host_name: string;
  location: string;
  description: string;
  signup_mode: ScheduleSignupMode;
  signup_url: string;
  public_status: SchedulePublicStatus;
  display_order: string;
};

const EMPTY: Form = {
  edition_id: '',
  day: '',
  title: '',
  section: 'programme',
  kind: 'special',
  is_all_day: false,
  start_time: '10:00',
  end_time: '11:00',
  host_name: '',
  location: '',
  description: '',
  signup_mode: 'none',
  signup_url: '',
  public_status: 'draft',
  display_order: '0',
};

const SECTION_OPTIONS: Array<[ScheduleSection, string]> = [
  ['always-on', 'Explore all day'],
  ['programme', 'Timed programme'],
  ['playtesting', 'Playtests'],
  ['publisher-showcase', 'Publisher showcases'],
  ['event-floor', 'Event floor'],
];

const KIND_OPTIONS: ScheduleKind[] = ['open-play', 'ttrpg', 'story-game', 'puzzle', 'workshop', 'tournament', 'quiz', 'social-game', 'playtest', 'publisher-showcase', 'booth', 'food', 'merch', 'amenity', 'talk', 'meal', 'special'];

function datesForEdition(edition?: EditionRow): string[] {
  if (!edition) return [];
  const dates: string[] = [];
  const current = new Date(`${edition.start_date}T00:00:00Z`);
  const end = new Date(`${edition.end_date}T00:00:00Z`);
  while (current <= end && dates.length < 10) {
    dates.push(current.toISOString().slice(0, 10));
    current.setUTCDate(current.getUTCDate() + 1);
  }
  return dates;
}

export default function ProgrammeDrawer() {
  const nav = useNavigate();
  const { id } = useParams();
  const [search] = useSearchParams();
  const isNew = !id;
  const [editions, setEditions] = useState<EditionRow[]>([]);
  const [form, setForm] = useState<Form>(EMPTY);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [showRebuild, setShowRebuild] = useState(false);
  const [rebuilding, setRebuilding] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const editionsRes = await fetchAdmin<{ editions: EditionRow[] }>('/api/admin/editions');
        setEditions(editionsRes.editions);
        if (isNew) {
          const requested = search.get('edition_id');
          const edition = editionsRes.editions.find((item) => item.id === requested)
            ?? editionsRes.editions.find((item) => item.is_current)
            ?? editionsRes.editions[0];
          setForm((current) => ({ ...current, edition_id: edition?.id ?? '', day: edition?.start_date ?? '' }));
        } else {
          const itemRes = await fetchAdmin<{ item: ScheduleItemRow }>(`/api/admin/schedule/${id}`);
          const item = itemRes.item;
          setForm({
            edition_id: item.edition_id,
            day: item.day,
            title: item.title,
            section: item.section,
            kind: item.kind,
            is_all_day: item.is_all_day,
            start_time: item.start_time?.slice(0, 5) ?? '10:00',
            end_time: item.end_time?.slice(0, 5) ?? '11:00',
            host_name: item.host_name ?? '',
            location: item.location ?? '',
            description: item.description ?? '',
            signup_mode: item.signup_mode,
            signup_url: item.signup_url ?? '',
            public_status: item.public_status,
            display_order: String(item.display_order),
          });
        }
        setLoaded(true);
      } catch (error) {
        showApiError(error);
        nav('/programme');
      }
    })();
  }, [id, isNew, nav, search]);

  const selectedEdition = editions.find((edition) => edition.id === form.edition_id);
  const dayOptions = useMemo(() => datesForEdition(selectedEdition), [selectedEdition]);

  function set<K extends keyof Form>(key: K, value: Form[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function changeEdition(editionId: string) {
    const edition = editions.find((item) => item.id === editionId);
    setForm((current) => ({ ...current, edition_id: editionId, day: edition?.start_date ?? '' }));
  }

  async function save() {
    if (!form.edition_id || !form.day || !form.title.trim()) {
      toast.error('Edition, day and title are required.');
      return;
    }
    if (!form.is_all_day && form.end_time <= form.start_time) {
      toast.error('End time must be after start time.');
      return;
    }

    setBusy(true);
    const payload = {
      ...form,
      title: form.title.trim(),
      description: form.description.trim() || null,
      host_name: form.host_name.trim() || null,
      location: form.location.trim() || null,
      signup_url: form.signup_url.trim() || null,
      start_time: form.is_all_day ? null : form.start_time,
      end_time: form.is_all_day ? null : form.end_time,
      display_order: Number(form.display_order),
    };
    try {
      if (isNew) await fetchAdmin('/api/admin/schedule', { method: 'POST', body: JSON.stringify(payload) });
      else await fetchAdmin(`/api/admin/schedule/${id}`, { method: 'PATCH', body: JSON.stringify(payload) });
      toast.success(isNew ? 'Programme item created' : 'Programme item saved');
      setShowRebuild(true);
    } catch (error) {
      showApiError(error);
    } finally {
      setBusy(false);
    }
  }

  async function rebuild() {
    setRebuilding(true);
    try {
      await fetchAdmin('/api/admin/rebuild', { method: 'POST' });
      toast.success('Site rebuilding… (~60s)');
    } catch (error) {
      showApiError(error, 'Saved, but rebuild failed. Use the Rebuild button later.');
    } finally {
      setRebuilding(false);
      setShowRebuild(false);
      nav('/programme');
    }
  }

  if (!loaded) return null;

  return (
    <Sheet open onOpenChange={(open) => { if (!open && !showRebuild) nav('/programme'); }}>
      <SheetContent className="w-full overflow-y-auto p-6 sm:max-w-lg">
        <SheetHeader className="p-0 pr-8">
          <SheetTitle>{isNew ? 'New programme item' : 'Edit programme item'}</SheetTitle>
          <SheetDescription>Draft details stay private. Published and cancelled items appear after a site rebuild.</SheetDescription>
        </SheetHeader>

        <div className="mt-5 space-y-4">
          <Field label="Edition">
            <select aria-label="Edition" value={form.edition_id} onChange={(event) => changeEdition(event.target.value)} className="w-full rounded-md border px-3 py-2">
              {editions.map((edition) => <option key={edition.id} value={edition.id}>{edition.slug} · {edition.start_date}</option>)}
            </select>
          </Field>
          <Field label="Event day">
            <select aria-label="Event day" value={form.day} onChange={(event) => set('day', event.target.value)} className="w-full rounded-md border px-3 py-2">
              {dayOptions.map((day) => <option key={day} value={day}>{day}</option>)}
            </select>
          </Field>
          <Field label="Title"><input aria-label="Title" value={form.title} maxLength={160} onChange={(event) => set('title', event.target.value)} className="w-full rounded-md border px-3 py-2" /></Field>

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Public section">
              <select aria-label="Public section" value={form.section} onChange={(event) => set('section', event.target.value as ScheduleSection)} className="w-full rounded-md border px-3 py-2">
                {SECTION_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
            </Field>
            <Field label="Activity type">
              <select aria-label="Activity type" value={form.kind} onChange={(event) => set('kind', event.target.value as ScheduleKind)} className="w-full rounded-md border px-3 py-2">
                {KIND_OPTIONS.map((kind) => <option key={kind} value={kind}>{kind}</option>)}
              </select>
            </Field>
          </div>

          <label className="flex items-center gap-2"><input type="checkbox" checked={form.is_all_day} onChange={(event) => set('is_all_day', event.target.checked)} /> All-day item</label>
          {!form.is_all_day && (
            <div className="grid grid-cols-2 gap-3">
              <Field label="Start time"><input aria-label="Start time" type="time" value={form.start_time} onChange={(event) => set('start_time', event.target.value)} className="w-full rounded-md border px-3 py-2" /></Field>
              <Field label="End time"><input aria-label="End time" type="time" value={form.end_time} onChange={(event) => set('end_time', event.target.value)} className="w-full rounded-md border px-3 py-2" /></Field>
            </div>
          )}

          <Field label="Public host or organiser"><input aria-label="Public host or organiser" value={form.host_name} onChange={(event) => set('host_name', event.target.value)} className="w-full rounded-md border px-3 py-2" /></Field>
          <Field label="Public location"><input aria-label="Public location" value={form.location} onChange={(event) => set('location', event.target.value)} className="w-full rounded-md border px-3 py-2" /></Field>
          <Field label="Public description"><textarea aria-label="Public description" value={form.description} maxLength={2000} rows={4} onChange={(event) => set('description', event.target.value)} className="w-full rounded-md border px-3 py-2" /></Field>

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Sign-up method">
              <select aria-label="Sign-up method" value={form.signup_mode} onChange={(event) => set('signup_mode', event.target.value as ScheduleSignupMode)} className="w-full rounded-md border px-3 py-2">
                <option value="none">No sign-up note</option>
                <option value="walk-in">Walk in</option>
                <option value="advance">Advance sign-up</option>
                <option value="on-site">Sign up on site</option>
              </select>
            </Field>
            <Field label="Display order"><input aria-label="Display order" type="number" min="0" step="1" value={form.display_order} onChange={(event) => set('display_order', event.target.value)} className="w-full rounded-md border px-3 py-2" /></Field>
          </div>
          <Field label="Sign-up URL (optional)"><input aria-label="Sign-up URL (optional)" type="url" placeholder="https://" value={form.signup_url} onChange={(event) => set('signup_url', event.target.value)} className="w-full rounded-md border px-3 py-2" /></Field>
          <Field label="Public status">
            <select aria-label="Public status" value={form.public_status} onChange={(event) => set('public_status', event.target.value as SchedulePublicStatus)} className="w-full rounded-md border px-3 py-2">
              <option value="draft">Draft — private</option>
              <option value="published">Published</option>
              <option value="cancelled">Cancelled — shown publicly</option>
            </select>
          </Field>

          <button disabled={busy} onClick={save} className="w-full rounded-md bg-primary px-3 py-2 font-medium text-primary-foreground disabled:opacity-50">
            {busy ? 'Saving…' : isNew ? 'Create item' : 'Save item'}
          </button>
        </div>

        <Dialog open={showRebuild} onOpenChange={(open) => { if (!open) { setShowRebuild(false); nav('/programme'); } }}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Rebuild the public site?</DialogTitle>
              <DialogDescription>Programme changes are baked into the public site. Rebuild now to publish them, or do it later from the admin header.</DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <button onClick={() => { setShowRebuild(false); nav('/programme'); }} className="w-full rounded-md border px-3 py-2 text-sm sm:w-auto">Do later</button>
              <button disabled={rebuilding} onClick={rebuild} className="w-full rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50 sm:w-auto">{rebuilding ? 'Rebuilding…' : 'Rebuild now'}</button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </SheetContent>
    </Sheet>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label><span className="mb-1 block text-sm text-muted-foreground">{label}</span>{children}</label>;
}
