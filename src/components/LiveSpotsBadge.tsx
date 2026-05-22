import { useEffect, useState } from 'react';
import { getEditionSpots } from '../lib/worker';
import type { ApiEditionSpotsResponse } from '../lib/types';

export interface LiveSpotsBadgeProps {
  editionId: string;
}

function fillColor(remaining: number, capacity: number, soldOut: boolean): string {
  if (soldOut || capacity === 0) return 'var(--color-pink)';
  const pct = remaining / capacity;
  if (pct <= 0) return 'var(--color-pink)';
  if (pct < 0.25) return 'var(--color-orange)';
  return 'var(--color-green)';
}

function DayBar({ label, capacity, remaining, soldOut }: { label: string; capacity: number; remaining: number; soldOut: boolean }) {
  // Fill represents REMAINING capacity, not consumed
  const filledPct = soldOut
    ? 0
    : capacity === 0
      ? 0
      : Math.max(0, Math.min(100, (remaining / capacity) * 100));
  const color = fillColor(remaining, capacity, soldOut);
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between gap-3">
        <span
          className="font-bold text-sm uppercase tracking-widest"
          style={{ fontFamily: 'var(--font-heading)' }}
        >
          {label}
        </span>
        <span className="text-sm font-semibold" style={{ color }}>
          {soldOut ? 'Sold out' : `${remaining} left`}
        </span>
      </div>
      <div
        role="progressbar"
        aria-valuenow={Math.round(filledPct)}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={`${label} ${soldOut ? 'sold out' : `${remaining} spots remaining`}`}
        className="w-full overflow-hidden"
        style={{
          height: '14px',
          borderRadius: '999px',
          border: '3px solid var(--color-ink)',
          background: 'var(--color-ink)',
        }}
      >
        <div
          className="h-full"
          style={{
            width: `${filledPct}%`,
            background: color,
            transition: 'width 0.3s',
          }}
        />
      </div>
    </div>
  );
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

  return (
    <div className="w-full max-w-md mx-auto flex flex-col gap-3 text-left">
      <DayBar label="Sat" capacity={spots.day1.capacity} remaining={spots.day1.remaining} soldOut={spots.day1.sold_out} />
      <DayBar label="Sun" capacity={spots.day2.capacity} remaining={spots.day2.remaining} soldOut={spots.day2.sold_out} />
    </div>
  );
}

export default LiveSpotsBadge;
