import { useEffect, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { fetchAdmin, showApiError } from '@/lib/api';
import type { AnnouncementAudience, AnnouncementRow, AnnouncementSeverity, EditionRow } from '@/lib/types';

/**
 * How long a notice stays up when no end time is given.
 *
 * Change this in one place. Short, because a notice is a thing that is true for
 * a moment, and one still on screen after it stops being true is how a live
 * board loses its authority -- but not so short that it is gone before anyone
 * looks. Two minutes was the first try and missed that: the push had landed,
 * so people with notifications on were fine, while anyone opening the app a
 * few minutes later found nothing at all.
 */
const DEFAULT_WINDOW_MINUTES = 5;

/** The severities that reach a phone. The other one only updates the app. */
const PUSHES: AnnouncementSeverity[] = ['urgent', 'incident'];

type Form = {
  edition_id: string;
  title: string;
  body: string;
  severity: AnnouncementSeverity;
  audience: AnnouncementAudience;
  /** 'now' is not stored -- it resolves to a starts_at of the moment you save. */
  mode: 'now' | 'schedule';
  starts_at: string;
  ends_at: string;
  is_published: boolean;
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

function defaultStart(): string {
  const rounded = new Date();
  rounded.setUTCMinutes(Math.ceil(rounded.getUTCMinutes() / 5) * 5, 0, 0);
  return isoToIstInput(rounded.toISOString());
}

const EMPTY: Form = {
  edition_id: '',
  title: '',
  body: '',
  severity: 'info',
  audience: 'all',
  // Send now by default: during the event the reason to write a notice is
  // almost always that something has just happened. Scheduling is the
  // exception, so it is the one you opt into.
  mode: 'now',
  starts_at: defaultStart(),
  ends_at: '',
  is_published: false,
};

export default function AnnouncementDrawer() {
  const nav = useNavigate();
  const { id } = useParams();
  const [search] = useSearchParams();
  const isNew = !id;
  const [editions, setEditions] = useState<EditionRow[]>([]);
  const [form, setForm] = useState<Form>(EMPTY);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

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
          const response = await fetchAdmin<{ announcement: AnnouncementRow }>(`/api/admin/announcements/${id}`);
          const announcement = response.announcement;
          setForm({
            edition_id: announcement.edition_id,
            title: announcement.title,
            body: announcement.body,
            severity: announcement.severity,
            audience: announcement.audience,
            // An existing notice always has a real start time, and re-saving it
            // must not silently move that to now.
            mode: 'schedule',
            starts_at: isoToIstInput(announcement.starts_at),
            ends_at: announcement.ends_at ? isoToIstInput(announcement.ends_at) : '',
            is_published: announcement.is_published,
          });
        }
        setLoaded(true);
      } catch (error) {
        showApiError(error);
        nav('/announcements');
      }
    })();
  }, [id, isNew, nav, search]);

  function set<K extends keyof Form>(key: K, value: Form[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  async function save() {
    const scheduled = form.mode === 'schedule';
    if (!form.edition_id || !form.title.trim() || !form.body.trim() || (scheduled && !form.starts_at)) {
      toast.error(scheduled
        ? 'Edition, title, message and start time are required.'
        : 'Edition, title and message are required.');
      return;
    }

    let startsAt: string;
    let endsAt: string;
    try {
      // "Send now" is not a mode the API knows about -- it is a start time of
      // this moment, which the Worker reads as live and dispatches at once.
      startsAt = scheduled ? istInputToIso(form.starts_at) : new Date().toISOString();
      // Blank means the default window, not forever. A notice with no end sits
      // on the board after it has stopped being true.
      endsAt = form.ends_at
        ? istInputToIso(form.ends_at)
        : new Date(new Date(startsAt).getTime() + DEFAULT_WINDOW_MINUTES * 60_000).toISOString();
    } catch {
      toast.error('Use valid IST dates and times.');
      return;
    }
    if (endsAt <= startsAt) {
      toast.error('End time must be after start time.');
      return;
    }

    setBusy(true);
    const payload = {
      edition_id: form.edition_id,
      title: form.title.trim(),
      body: form.body.trim(),
      severity: form.severity,
      audience: form.audience,
      starts_at: startsAt,
      ends_at: endsAt,
      is_published: form.is_published,
    };
    try {
      if (isNew) await fetchAdmin('/api/admin/announcements', { method: 'POST', body: JSON.stringify(payload) });
      else await fetchAdmin(`/api/admin/announcements/${id}`, { method: 'PATCH', body: JSON.stringify(payload) });
      toast.success(isNew ? 'Announcement created' : 'Announcement saved');
      nav('/announcements');
    } catch (error) {
      showApiError(error);
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    setBusy(true);
    try {
      await fetchAdmin(`/api/admin/announcements/${id}`, { method: 'DELETE' });
      toast.success('Announcement deleted');
      nav('/announcements');
    } catch (error) {
      showApiError(error);
    } finally {
      setBusy(false);
      setConfirmDelete(false);
    }
  }

  if (!loaded) return null;

  return (
    <Sheet open onOpenChange={(open) => { if (!open) nav('/announcements'); }}>
      <SheetContent className="w-full overflow-y-auto p-6 sm:max-w-lg">
        <SheetHeader className="p-0 pr-8">
          <SheetTitle>{isNew ? 'New announcement' : 'Edit announcement'}</SheetTitle>
          <SheetDescription>Published notices update the attendee app at runtime, usually within one minute. All times below are IST.</SheetDescription>
        </SheetHeader>

        <div className="mt-5 space-y-4">
          <Field label="Edition">
            <select aria-label="Edition" value={form.edition_id} onChange={(event) => set('edition_id', event.target.value)} className="w-full rounded-md border px-3 py-2">
              {editions.map((edition) => <option key={edition.id} value={edition.id}>{edition.slug} · {edition.start_date}</option>)}
            </select>
          </Field>
          <Field label="Title"><input aria-label="Title" value={form.title} maxLength={120} onChange={(event) => set('title', event.target.value)} className="w-full rounded-md border px-3 py-2" /></Field>
          <Field label="Message"><textarea aria-label="Message" value={form.body} maxLength={2000} rows={6} onChange={(event) => set('body', event.target.value)} className="w-full rounded-md border px-3 py-2" /></Field>

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Severity">
              <select aria-label="Severity" value={form.severity} onChange={(event) => set('severity', event.target.value as AnnouncementSeverity)} className="w-full rounded-md border px-3 py-2">
                <option value="info">Information — app only</option>
                <option value="urgent">Urgent change — notifies phones</option>
                <option value="incident">Safety incident — notifies phones</option>
              </select>
              {/* Which severities buzz a phone is not guessable from their
                  names, and picking wrong means nobody is told at all. */}
              <span className="mt-1 block text-xs text-muted-foreground">
                {PUSHES.includes(form.severity)
                  ? 'Sends a push notification to attendees who turned them on.'
                  : 'Appears in the app only. No phone will be notified.'}
              </span>
            </Field>
            <Field label="Audience">
              <select aria-label="Audience" value={form.audience} onChange={(event) => set('audience', event.target.value as AnnouncementAudience)} className="w-full rounded-md border px-3 py-2">
                <option value="all">Everyone</option>
                <option value="day1">Day 1 attendees</option>
                <option value="day2">Day 2 attendees</option>
              </select>
            </Field>
          </div>

          <fieldset className="rounded-md border p-3">
            <legend className="px-1 text-sm text-muted-foreground">When</legend>
            <div className="flex flex-wrap gap-4">
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="radio"
                  name="mode"
                  value="now"
                  checked={form.mode === 'now'}
                  onChange={() => set('mode', 'now')}
                />
                Send now
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="radio"
                  name="mode"
                  value="schedule"
                  checked={form.mode === 'schedule'}
                  onChange={() => set('mode', 'schedule')}
                />
                Schedule
              </label>
            </div>

            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              {form.mode === 'schedule' && (
                <Field label="Starts at (IST)"><input aria-label="Starts at (IST)" type="datetime-local" value={form.starts_at} onChange={(event) => set('starts_at', event.target.value)} className="w-full rounded-md border px-3 py-2" /></Field>
              )}
              <Field label="Ends at (IST, optional)"><input aria-label="Ends at (IST, optional)" type="datetime-local" value={form.ends_at} onChange={(event) => set('ends_at', event.target.value)} className="w-full rounded-md border px-3 py-2" /></Field>
            </div>

            <p className="mt-2 text-xs text-muted-foreground">
              {form.mode === 'now'
                ? `Goes live the moment you save, and notifies phones then. Leave the end time blank and it clears ${DEFAULT_WINDOW_MINUTES} minutes later.`
                : `Nothing is sent until the start time — the notice waits, then goes out within a minute of it. Leave the end time blank and it clears ${DEFAULT_WINDOW_MINUTES} minutes after that.`}
            </p>
          </fieldset>

          <label className="flex items-start gap-3 rounded-md border bg-muted/40 p-3">
            <input aria-label="Published" type="checkbox" checked={form.is_published} onChange={(event) => set('is_published', event.target.checked)} className="mt-1" />
            <span><strong className="block text-sm">Published</strong><span className="text-sm text-muted-foreground">The notice becomes public only during its delivery window. Leave this off to save a draft.</span></span>
          </label>

          <button disabled={busy} onClick={save} className="w-full rounded-md bg-primary px-3 py-2 font-medium text-primary-foreground disabled:opacity-50">
            {busy ? 'Saving…' : isNew ? 'Create announcement' : 'Save announcement'}
          </button>

          {!isNew && (
            <button
              type="button"
              disabled={busy}
              onClick={() => setConfirmDelete(true)}
              className="w-full rounded-md border border-destructive px-3 py-2 text-sm font-medium text-destructive disabled:opacity-50"
            >
              Delete announcement
            </button>
          )}
        </div>

        <Dialog open={confirmDelete} onOpenChange={setConfirmDelete}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Delete “{form.title}”?</DialogTitle>
              <DialogDescription>
                {form.is_published
                  ? 'The notice disappears from the attendee app within a minute. A push that has already gone out stays on the phones that got it — unticking Published hides the notice just as well, and keeps the record.'
                  : 'This draft goes for good. The audit log keeps a copy of the text.'}
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <button type="button" onClick={() => setConfirmDelete(false)} className="w-full rounded-md border px-3 py-2 text-sm sm:w-auto">
                Cancel
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => { void remove(); }}
                className="w-full rounded-md bg-destructive px-3 py-2 text-sm font-medium text-white disabled:opacity-50 sm:w-auto"
              >
                {busy ? 'Deleting…' : 'Delete notice'}
              </button>
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
