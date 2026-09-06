import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { fetchAdmin, showApiError } from '@/lib/api';
import { onRevalidate } from '@/lib/revalidate';
import type { EditionRow, PromoCodeRow } from '@/lib/types';

type PromoState = 'draft' | 'scheduled' | 'live' | 'expired' | 'exhausted';

const STATE_STYLE: Record<PromoState, string> = {
  draft: 'bg-muted',
  scheduled: 'bg-blue-100 text-blue-900',
  live: 'bg-green-100 text-green-900',
  expired: 'bg-zinc-200 text-zinc-700',
  exhausted: 'bg-amber-100 text-amber-950',
};

/**
 * The one label that answers "can someone use this right now?". It folds the
 * active flag, the validity window, and the redemption cap together, because a
 * code fails for any of the three and an organiser should not have to check
 * three fields to find out which.
 */
export function promoState(promo: PromoCodeRow, now = new Date()): PromoState {
  if (!promo.is_active) return 'draft';
  if (promo.max_redemptions !== null && promo.redemption_count >= promo.max_redemptions) return 'exhausted';
  if (promo.starts_at && new Date(promo.starts_at) > now) return 'scheduled';
  if (promo.ends_at && new Date(promo.ends_at) <= now) return 'expired';
  return 'live';
}

export function discountLabel(promo: PromoCodeRow): string {
  const value = promo.discount_type === 'percent' ? `${promo.discount_value}% off` : `₹${promo.discount_value} off`;
  const cap = promo.max_discount !== null ? ` (max ₹${promo.max_discount})` : '';
  const scope = promo.scope === 'first_ticket' ? ' first ticket' : ' the booking';
  // The floor only earns a mention when there is one; every code has a
  // min_quantity of 1 and saying so on all of them would be noise.
  const bulk = promo.min_quantity > 1 ? ` · ${promo.min_quantity}+ tickets` : '';
  return `${value}${cap} —${scope}${bulk}`;
}

function formatIst(value: string): string {
  return new Intl.DateTimeFormat('en-IN', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Asia/Kolkata',
  }).format(new Date(value));
}

export default function Promos() {
  const [editions, setEditions] = useState<EditionRow[]>([]);
  const [editionId, setEditionId] = useState('');
  const [promos, setPromos] = useState<PromoCodeRow[]>([]);
  const [state, setState] = useState<PromoState | 'all'>('all');
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

  async function loadPromos(selectedEditionId: string) {
    if (!selectedEditionId) return;
    setLoading(true);
    try {
      const response = await fetchAdmin<{ promo_codes: PromoCodeRow[] }>(
        `/api/admin/promo-codes?edition_id=${encodeURIComponent(selectedEditionId)}`,
      );
      setPromos(response.promo_codes);
    } catch (error) {
      showApiError(error);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void loadPromos(editionId); }, [editionId]);
  useEffect(() => {
    const off = onRevalidate(() => { void loadPromos(editionId); });
    return () => { off(); };
  }, [editionId]);

  const visible = useMemo(
    () => promos.filter((promo) => state === 'all' || promoState(promo) === state),
    [promos, state],
  );

  return (
    <div className="p-4 md:p-6">
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Promo codes</h1>
          <p className="text-sm text-muted-foreground">
            Discounts attendees can apply when buying tickets. Each code carries the message shown the moment it is accepted.
          </p>
        </div>
        <Link
          to={`/promos/new?edition_id=${encodeURIComponent(editionId)}`}
          className={`rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground ${!editionId ? 'pointer-events-none opacity-50' : ''}`}
        >
          New promo code
        </Link>
      </div>

      <div className="mb-5 grid gap-3 sm:grid-cols-2">
        <label>
          <span className="mb-1 block text-sm text-muted-foreground">Edition</span>
          <select value={editionId} onChange={(event) => setEditionId(event.target.value)} className="w-full rounded-md border bg-background px-3 py-2">
            {editions.map((edition) => <option key={edition.id} value={edition.id}>{edition.slug} · {edition.start_date}</option>)}
          </select>
        </label>
        <label>
          <span className="mb-1 block text-sm text-muted-foreground">State</span>
          <select value={state} onChange={(event) => setState(event.target.value as PromoState | 'all')} className="w-full rounded-md border bg-background px-3 py-2">
            <option value="all">All states</option>
            <option value="live">Live</option>
            <option value="scheduled">Scheduled</option>
            <option value="draft">Inactive</option>
            <option value="exhausted">Fully claimed</option>
            <option value="expired">Expired</option>
          </select>
        </label>
      </div>

      {loading ? (
        <div className="text-muted-foreground">Loading…</div>
      ) : visible.length === 0 ? (
        <div className="rounded-md border bg-background p-6">
          <h2 className="font-semibold">No promo codes match</h2>
          <p className="mt-1 text-sm text-muted-foreground">Create one, or clear a filter to see codes from earlier campaigns.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {visible.map((promo) => {
            const state = promoState(promo);
            return (
              <Link key={promo.id} to={`/promos/${promo.id}`} className="block rounded-md border bg-background p-4 hover:bg-muted">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="mb-2 flex flex-wrap gap-2 text-xs">
                      <span className={`rounded-full px-2 py-0.5 ${STATE_STYLE[state]}`}>{state === 'draft' ? 'inactive' : state}</span>
                      {promo.pass_type && <span className="rounded-full border px-2 py-0.5">{promo.pass_type === 'campaign' ? '2-day only' : '1-day only'}</span>}
                    </div>
                    <h2 className="font-mono text-lg font-bold">{promo.code}</h2>
                    <p className="text-sm text-muted-foreground">{discountLabel(promo)}</p>
                    <p className="mt-1 line-clamp-2 text-sm">{promo.applied_message}</p>
                  </div>
                  <div className="shrink-0 text-left text-xs text-muted-foreground sm:text-right">
                    <div className="font-mono text-sm text-foreground">
                      {promo.redemption_count}
                      {promo.max_redemptions !== null ? ` / ${promo.max_redemptions}` : ''} used
                    </div>
                    {promo.starts_at && <div className="mt-1">from {formatIst(promo.starts_at)}</div>}
                    {promo.ends_at && <div>to {formatIst(promo.ends_at)}</div>}
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
