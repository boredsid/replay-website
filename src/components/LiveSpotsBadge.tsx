// src/components/LiveSpotsBadge.tsx
import { useEffect, useState } from 'react';
import { getEditionSpots } from '../lib/worker';
import type { ApiEditionSpotsResponse } from '../lib/types';

export interface LiveSpotsBadgeProps {
  editionId: string;
}

export function LiveSpotsBadge({ editionId }: LiveSpotsBadgeProps) {
  const [spots, setSpots] = useState<ApiEditionSpotsResponse | null>(null);
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    getEditionSpots(editionId)
      .then((r) => { if (!cancelled) { setSpots(r); setLoading(false); } })
      .catch(() => { if (!cancelled) { setError(true); setLoading(false); } });
    return () => { cancelled = true; };
  }, [editionId]);

  if (error) return null;
  if (loading) return <span className="text-sm text-gray-500">Loading…</span>;
  if (!spots) return null;
  if (spots.both_sold_out) return <span className="text-sm font-medium text-red-700">Sold out</span>;
  return (
    <span className="text-sm text-gray-700">
      Day 1: {spots.day1.remaining} left · Day 2: {spots.day2.remaining} left
    </span>
  );
}

export default LiveSpotsBadge;
