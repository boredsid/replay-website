import { useEffect, useState } from 'react';
import { getEditionSpots } from '../lib/worker';
import type { ApiEditionSpotsResponse } from '../lib/types';

export interface LiveSpotsBadgeProps {
  editionId: string;
  day1Label?: string;
  day2Label?: string;
}

export function LiveSpotsBadge({ editionId, day1Label = 'Day 1', day2Label = 'Day 2' }: LiveSpotsBadgeProps) {
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

  if (error) return <p role="status" className="text-sm font-medium">Live availability is temporarily unavailable.</p>;
  if (loading) return <span className="text-sm text-[#1A1A1A]/70">Loading…</span>;
  if (!spots) return null;

  // Combined capacity across both days (matches bgc's single-event bar pattern)
  const totalCapacity = spots.day1.capacity + spots.day2.capacity;
  const totalRemaining = spots.day1.remaining + spots.day2.remaining;
  const used = Math.max(0, totalCapacity - totalRemaining);
  const fillPct = totalCapacity > 0 ? Math.min(100, (used / totalCapacity) * 100) : 0;

  const bothSoldOut = spots.both_sold_out;
  const almostFull = !bothSoldOut && totalRemaining > 0 && totalRemaining <= 5;
  const barColor = bothSoldOut || almostFull ? '#DC2626' : '#1A1A1A';

  let spotsText: string;
  if (bothSoldOut) {
    spotsText = 'Event full';
  } else if (spots.day1.sold_out) {
    spotsText = `${day1Label} full · ${spots.day2.remaining} ${day2Label} spots left`;
  } else if (spots.day2.sold_out) {
    spotsText = `${day2Label} full · ${spots.day1.remaining} ${day1Label} spots left`;
  } else if (almostFull) {
    spotsText = `Almost full — ${totalRemaining} ${totalRemaining === 1 ? 'spot' : 'spots'} left`;
  } else {
    spotsText = `${totalRemaining} of ${totalCapacity} spots left`;
  }

  return (
    <div className="max-w-md">
      <div
        role="progressbar"
        aria-valuenow={Math.round(fillPct)}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={spotsText}
        className="w-full h-3 rounded-full overflow-hidden"
        style={{ border: '2px solid #1A1A1A', background: '#FFFFFF' }}
      >
        <div className="h-full" style={{ width: `${fillPct}%`, background: barColor, transition: 'width 0.3s' }} />
      </div>
      <p className="mt-2 text-sm font-semibold" style={{ color: barColor }}>{spotsText}</p>
    </div>
  );
}

export default LiveSpotsBadge;
