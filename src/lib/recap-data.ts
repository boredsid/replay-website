// src/lib/recap-data.ts
//
// Loads everything the recap needs for the edition being recapped, once per
// build: the Worker's figures, the programme, the partner wall and the shelf.
// The homepage, Get involved, /photos and the share card all read the same
// view, so they cannot quote different numbers.

import { getEditionRecap, getLibraryCatalogue, getScheduleItems, getSiteState, getSponsors } from './data';
import { recapView, type RecapView } from './recap';

let once: Promise<RecapView | null> | null = null;

/** The recap of the most recent ended edition, or null when none has ended. */
export function getRecapView(): Promise<RecapView | null> {
  once ??= (async () => {
    const { recap: edition } = await getSiteState();
    if (!edition) return null;
    const [recap, scheduleItems, sponsors, catalogue] = await Promise.all([
      getEditionRecap(edition.slug),
      getScheduleItems(edition.id),
      getSponsors(edition.id),
      getLibraryCatalogue(),
    ]);
    return recapView({
      edition,
      recap,
      scheduleItems,
      sponsors,
      shelfCount: catalogue.games.length,
    });
  })();
  return once;
}

/** Confirmed bookings per schedule item, for the programme record. */
export async function getSessionBookings(): Promise<Record<string, number>> {
  const { recap: edition } = await getSiteState();
  if (!edition) return {};
  const recap = await getEditionRecap(edition.slug);
  return Object.fromEntries((recap?.sessions.by_item ?? []).map((row) => [row.schedule_item_id, row.booked]));
}
