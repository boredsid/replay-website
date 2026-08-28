import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import RebuildSiteButton from '@/components/RebuildSiteButton';
import { fetchAdmin, showApiError } from '@/lib/api';
import { onRevalidate } from '@/lib/revalidate';
import type { EditionRow, SponsorRow, SponsorTier } from '@/lib/types';

// The ladder from docs/SPONSORSHIP.md, plus community for everyone credited
// on the wall without a package. Order here is wall order.
const TIER_LABEL: Record<SponsorTier, string> = {
  title: 'Title sponsor',
  association: 'In association with',
  venue: 'Venue partner',
  zone: 'Zone partner',
  gaming: 'Gaming partner',
  community: 'Community partner',
};

const TIER_STYLE: Record<SponsorTier, string> = {
  title: 'bg-amber-100 text-amber-950',
  association: 'bg-orange-100 text-orange-950',
  venue: 'bg-violet-100 text-violet-900',
  zone: 'bg-teal-100 text-teal-900',
  gaming: 'bg-blue-100 text-blue-900',
  community: 'bg-zinc-200 text-zinc-800',
};

export default function Sponsors() {
  const [editions, setEditions] = useState<EditionRow[]>([]);
  const [editionId, setEditionId] = useState('');
  const [sponsors, setSponsors] = useState<SponsorRow[]>([]);
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

  async function loadSponsors(selectedEditionId: string) {
    if (!selectedEditionId) return;
    setLoading(true);
    try {
      const response = await fetchAdmin<{ sponsors: SponsorRow[] }>(
        `/api/admin/sponsors?edition_id=${encodeURIComponent(selectedEditionId)}`,
      );
      setSponsors(response.sponsors);
    } catch (error) {
      showApiError(error);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void loadSponsors(editionId); }, [editionId]);
  useEffect(() => {
    const off = onRevalidate(() => { void loadSponsors(editionId); });
    return () => { off(); };
  }, [editionId]);

  return (
    <div className="p-4 md:p-6">
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Sponsor logos</h1>
          <p className="text-sm text-muted-foreground">
            The logo wall on replaycon.in. Upload artwork, set where each logo links, and pick a tier — the wall ranks by tier and sorts by name inside it.
          </p>
        </div>
        <Link
          to={`/sponsors/new?edition_id=${encodeURIComponent(editionId)}`}
          className={`rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground ${!editionId ? 'pointer-events-none opacity-50' : ''}`}
        >
          New sponsor
        </Link>
      </div>

      <div className="mb-5 flex flex-wrap items-end gap-3">
        <label className="min-w-60 flex-1">
          <span className="mb-1 block text-sm text-muted-foreground">Edition</span>
          <select
            aria-label="Edition"
            value={editionId}
            onChange={(event) => setEditionId(event.target.value)}
            className="w-full rounded-md border bg-background px-3 py-2"
          >
            {editions.map((edition) => (
              <option key={edition.id} value={edition.id}>{edition.slug} · {edition.start_date}</option>
            ))}
          </select>
        </label>
      </div>

      <div className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-md border bg-muted/40 p-3">
        <p className="text-sm text-muted-foreground">
          The wall is baked into the public site, so uploads and edits appear only after the next rebuild.
        </p>
        <RebuildSiteButton className="bg-background" />
      </div>

      {loading ? (
        <div className="text-muted-foreground">Loading…</div>
      ) : sponsors.length === 0 ? (
        <div className="rounded-md border bg-background p-6">
          <h2 className="font-semibold">No sponsor logos yet</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Add one and it joins the wall on the next rebuild. With no sponsors for this edition the wall hides itself.
          </p>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {sponsors.map((sponsor) => (
            <Link
              key={sponsor.id}
              to={`/sponsors/${sponsor.id}`}
              className="block rounded-md border bg-background p-4 hover:bg-muted"
            >
              <div className="mb-3 flex h-24 items-center justify-center rounded-md border bg-white p-3">
                <img src={sponsor.logo_url} alt={sponsor.name} className="max-h-full max-w-full object-contain" />
              </div>
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <span className={`rounded-full px-2 py-0.5 ${TIER_STYLE[sponsor.tier]}`}>{TIER_LABEL[sponsor.tier]}</span>
              </div>
              <h2 className="mt-2 font-semibold">{sponsor.name}</h2>
              <p className="mt-1 truncate text-sm text-muted-foreground">
                {sponsor.website_url ?? 'No link — the logo is not clickable'}
              </p>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
