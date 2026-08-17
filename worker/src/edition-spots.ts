// worker/src/edition-spots.ts
import type { Env } from './index';
import { jsonResponse } from './validation';
import { getEditionById, getReservedSeatsByDay } from './editions';

export async function handleEditionSpots(editionId: string, env: Env): Promise<Response> {
  if (!editionId) return jsonResponse({ error: 'invalid edition_id' }, 400);
  const edition = await getEditionById(env, editionId);
  if (!edition) return jsonResponse({ error: 'not_found' }, 404);

  const seats = await getReservedSeatsByDay(env, editionId);
  const cap = edition.capacity_per_day;
  const day1Remaining = Math.max(0, cap.day1 - seats.day1);
  const day2Remaining = Math.max(0, cap.day2 - seats.day2);
  const day1SoldOut = day1Remaining === 0;
  const day2SoldOut = day2Remaining === 0;

  return jsonResponse({
    day1: { capacity: cap.day1, remaining: day1Remaining, sold_out: day1SoldOut },
    day2: { capacity: cap.day2, remaining: day2Remaining, sold_out: day2SoldOut },
    both_sold_out: day1SoldOut && day2SoldOut,
  });
}
