/**
 * `/link-preview.png` — the Open Graph / Twitter card image referenced by
 * `Layout.astro` on every page.
 *
 * This used to be a hand-exported PNG in `public/`, which meant the card kept
 * advertising whichever edition it was drawn for. It is now a static endpoint:
 * Astro evaluates it once per build and emits `dist/link-preview.png`, so the
 * card is redrawn from the current edition row by the same rebuild that
 * refreshes the pages. No artwork to re-export per edition.
 */
import type { APIRoute } from 'astro';
import { getCurrentEdition, getSiteState } from '../lib/data';
import { linkPreviewContent, wrappedLinkPreviewContent } from '../lib/link-preview';
import { getRecapView } from '../lib/recap-data';
import { renderLinkPreview } from '../../scripts/render-link-preview.ts';

export const GET: APIRoute = async () => {
  // Between editions the card stops advertising dates that have passed and
  // says what the last edition added up to instead.
  const site = await getSiteState();
  const content = site.phase === 'wrapped' && site.recap
    ? wrappedLinkPreviewContent({ ...site.recap, tickets: (await getRecapView())?.tickets ?? null })
    : linkPreviewContent(await getCurrentEdition());
  const png = await renderLinkPreview(content);
  return new Response(new Uint8Array(png), {
    headers: {
      'Content-Type': 'image/png',
      'Cache-Control': 'public, max-age=604800',
    },
  });
};
