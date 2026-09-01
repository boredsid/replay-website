import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { fetchAdmin, showApiError } from '@/lib/api';
import { onRevalidate } from '@/lib/revalidate';
import type { EditionRow, ScheduleItemRow, ScheduleSection } from '@/lib/types';

const SECTION_LABEL: Record<ScheduleSection, string> = {
  'always-on': 'Explore all day',
  programme: 'Timed programme',
  playtesting: 'Playtests',
  'publisher-showcase': 'Publisher showcases',
  'event-floor': 'Event floor',
};

function itemTime(item: ScheduleItemRow): string {
  if (item.is_all_day) return 'All day';
  return `${item.start_time?.slice(0, 5)}–${item.end_time?.slice(0, 5)}`;
}

export default function Programme() {
  const [editions, setEditions] = useState<EditionRow[]>([]);
  const [editionId, setEditionId] = useState('');
  const [items, setItems] = useState<ScheduleItemRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetchAdmin<{ editions: EditionRow[] }>('/api/admin/editions');
        setEditions(res.editions);
        const initial = res.editions.find((edition) => edition.is_current) ?? res.editions[0];
        if (initial) setEditionId(initial.id);
        else setLoading(false);
      } catch (error) {
        showApiError(error);
        setLoading(false);
      }
    })();
  }, []);

  async function loadItems(selectedEditionId: string) {
    if (!selectedEditionId) return;
    setLoading(true);
    try {
      const res = await fetchAdmin<{ items: ScheduleItemRow[] }>(`/api/admin/schedule?edition_id=${encodeURIComponent(selectedEditionId)}`);
      setItems(res.items);
    } catch (error) {
      showApiError(error);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { loadItems(editionId); }, [editionId]);
  useEffect(() => {
    const off = onRevalidate(() => loadItems(editionId));
    return () => { off(); };
  }, [editionId]);

  const groups = useMemo(() => {
    const map = new Map<string, ScheduleItemRow[]>();
    for (const item of items) {
      const key = `${item.day}|${item.section}`;
      map.set(key, [...(map.get(key) ?? []), item]);
    }
    return [...map.entries()];
  }, [items]);

  return (
    <div className="p-4 md:p-6">
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Programme</h1>
          <p className="text-sm text-muted-foreground">All-day activities, timed sessions, playtests, showcases and the event floor.</p>
        </div>
        <Link
          to={`/programme/new?edition_id=${encodeURIComponent(editionId)}`}
          className={`rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground ${!editionId ? 'pointer-events-none opacity-50' : ''}`}
        >
          New item
        </Link>
      </div>

      <label className="mb-5 block max-w-sm">
        <span className="mb-1 block text-sm text-muted-foreground">Edition</span>
        <select value={editionId} onChange={(event) => setEditionId(event.target.value)} className="w-full rounded-md border bg-background px-3 py-2">
          {editions.map((edition) => <option key={edition.id} value={edition.id}>{edition.slug} · {edition.start_date}</option>)}
        </select>
      </label>

      {loading ? (
        <div className="text-muted-foreground">Loading…</div>
      ) : items.length === 0 ? (
        <div className="rounded-md border bg-background p-6">
          <h2 className="font-semibold">No programme items yet</h2>
          <p className="mt-1 text-sm text-muted-foreground">Create draft items first, then publish them when the public details are confirmed.</p>
        </div>
      ) : (
        <div className="space-y-7">
          {groups.map(([key, group]) => {
            const [day, section] = key.split('|') as [string, ScheduleSection];
            return (
              <section key={key}>
                <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
                  <h2 className="text-lg font-semibold">{SECTION_LABEL[section]}</h2>
                  <span className="font-mono text-xs text-muted-foreground">{day}</span>
                </div>
                <div className="space-y-2">
                  {group.map((item) => (
                    <div key={item.id} className="flex flex-col gap-2 rounded-md border bg-background p-4 sm:flex-row sm:items-center sm:justify-between">
                      <Link to={`/programme/${item.id}`} className="min-w-0 hover:underline">
                        <div className="font-medium">{item.title}</div>
                        <div className="mt-1 text-sm text-muted-foreground">
                          {itemTime(item)}{item.host_name ? ` · ${item.host_name}` : ''}{item.location ? ` · ${item.location}` : ''}
                        </div>
                      </Link>
                      <div className="flex shrink-0 items-center gap-2 text-xs">
                        <span className="rounded-full border px-2 py-0.5">{item.kind}</span>
                        <span className={`rounded-full px-2 py-0.5 ${item.public_status === 'published' ? 'bg-green-100' : item.public_status === 'cancelled' ? 'bg-red-100' : 'bg-muted'}`}>
                          {item.public_status}
                        </span>
                        {/* Only bookable sessions have a roster worth opening. */}
                        {item.signup_mode === 'app' && (
                          <Link
                            to={`/programme/${item.id}/roster`}
                            className="rounded-full border px-2 py-0.5 font-medium hover:bg-muted"
                          >
                            Roster{item.capacity !== null ? ` · ${item.capacity}` : ''}
                          </Link>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
