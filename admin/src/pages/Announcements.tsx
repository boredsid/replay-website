import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { fetchAdmin, showApiError } from '@/lib/api';
import { onRevalidate } from '@/lib/revalidate';
import type { AnnouncementRow, AnnouncementSeverity, EditionRow } from '@/lib/types';

type DeliveryState = 'draft' | 'scheduled' | 'live' | 'expired';

const STATE_STYLE: Record<DeliveryState, string> = {
  draft: 'bg-muted',
  scheduled: 'bg-blue-100 text-blue-900',
  live: 'bg-green-100 text-green-900',
  expired: 'bg-zinc-200 text-zinc-700',
};

const SEVERITY_STYLE: Record<AnnouncementSeverity, string> = {
  info: 'bg-blue-100 text-blue-900',
  urgent: 'bg-amber-100 text-amber-950',
  incident: 'bg-red-100 text-red-950',
};

function deliveryState(item: AnnouncementRow, now = new Date()): DeliveryState {
  if (!item.is_published) return 'draft';
  if (new Date(item.starts_at) > now) return 'scheduled';
  if (item.ends_at && new Date(item.ends_at) <= now) return 'expired';
  return 'live';
}

function formatIst(value: string): string {
  return new Intl.DateTimeFormat('en-IN', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Asia/Kolkata',
  }).format(new Date(value));
}

export default function Announcements() {
  const [editions, setEditions] = useState<EditionRow[]>([]);
  const [editionId, setEditionId] = useState('');
  const [announcements, setAnnouncements] = useState<AnnouncementRow[]>([]);
  const [severity, setSeverity] = useState<AnnouncementSeverity | 'all'>('all');
  const [state, setState] = useState<DeliveryState | 'all'>('all');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const response = await fetchAdmin<{ editions: EditionRow[] }>('/api/admin/editions');
        setEditions(response.editions);
        const initial = response.editions.find((edition) => edition.is_current) ?? response.editions[0];
        if (initial) setEditionId(initial.id);
        else setLoading(false);
      } catch (error) {
        showApiError(error);
        setLoading(false);
      }
    })();
  }, []);

  async function loadAnnouncements(selectedEditionId: string) {
    if (!selectedEditionId) return;
    setLoading(true);
    try {
      const response = await fetchAdmin<{ announcements: AnnouncementRow[] }>(
        `/api/admin/announcements?edition_id=${encodeURIComponent(selectedEditionId)}`,
      );
      setAnnouncements(response.announcements);
    } catch (error) {
      showApiError(error);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void loadAnnouncements(editionId); }, [editionId]);
  useEffect(() => {
    const off = onRevalidate(() => { void loadAnnouncements(editionId); });
    return () => { off(); };
  }, [editionId]);

  const visible = useMemo(() => announcements.filter((announcement) => {
    if (severity !== 'all' && announcement.severity !== severity) return false;
    return state === 'all' || deliveryState(announcement) === state;
  }), [announcements, severity, state]);

  return (
    <div className="p-2 md:p-6">
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Announcements</h1>
          <p className="text-sm text-muted-foreground">Schedule attendee updates, urgent changes, and incident notices without rebuilding the site.</p>
        </div>
        <Link
          to={`/announcements/new?edition_id=${encodeURIComponent(editionId)}`}
          className={`rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground ${!editionId ? 'pointer-events-none opacity-50' : ''}`}
        >
          New announcement
        </Link>
      </div>

      <div className="mb-5 grid gap-3 sm:grid-cols-3">
        <label>
          <span className="mb-1 block text-sm text-muted-foreground">Edition</span>
          <select value={editionId} onChange={(event) => setEditionId(event.target.value)} className="w-full rounded-md border bg-background px-3 py-2">
            {editions.map((edition) => <option key={edition.id} value={edition.id}>{edition.slug} · {edition.start_date}</option>)}
          </select>
        </label>
        <label>
          <span className="mb-1 block text-sm text-muted-foreground">Delivery state</span>
          <select value={state} onChange={(event) => setState(event.target.value as DeliveryState | 'all')} className="w-full rounded-md border bg-background px-3 py-2">
            <option value="all">All states</option>
            <option value="live">Live</option>
            <option value="scheduled">Scheduled</option>
            <option value="draft">Draft</option>
            <option value="expired">Expired</option>
          </select>
        </label>
        <label>
          <span className="mb-1 block text-sm text-muted-foreground">Severity</span>
          <select value={severity} onChange={(event) => setSeverity(event.target.value as AnnouncementSeverity | 'all')} className="w-full rounded-md border bg-background px-3 py-2">
            <option value="all">All severities</option>
            <option value="info">Information</option>
            <option value="urgent">Urgent</option>
            <option value="incident">Incident</option>
          </select>
        </label>
      </div>

      {loading ? (
        <div className="text-muted-foreground">Loading…</div>
      ) : visible.length === 0 ? (
        <div className="rounded-md border bg-background p-6">
          <h2 className="font-semibold">No announcements match</h2>
          <p className="mt-1 text-sm text-muted-foreground">Create a draft or clear a filter to see earlier notices.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {visible.map((announcement) => {
            const delivery = deliveryState(announcement);
            return (
              <Link key={announcement.id} to={`/announcements/${announcement.id}`} className="block rounded-md border bg-background p-4 hover:bg-muted">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="mb-2 flex flex-wrap gap-2 text-xs">
                      <span className={`rounded-full px-2 py-0.5 ${SEVERITY_STYLE[announcement.severity]}`}>{announcement.severity}</span>
                      <span className={`rounded-full px-2 py-0.5 ${STATE_STYLE[delivery]}`}>{delivery}</span>
                      <span className="rounded-full border px-2 py-0.5">{announcement.audience}</span>
                    </div>
                    <h2 className="font-semibold">{announcement.title}</h2>
                    <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">{announcement.body}</p>
                  </div>
                  <div className="shrink-0 text-right font-mono text-xs text-muted-foreground">
                    <div>{formatIst(announcement.starts_at)} IST</div>
                    {announcement.ends_at && <div>to {formatIst(announcement.ends_at)} IST</div>}
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
