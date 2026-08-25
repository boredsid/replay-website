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
import { getCurrentEdition } from '../lib/data';
import { linkPreviewContent } from '../lib/link-preview';
import { renderLinkPreview } from '../../scripts/render-link-preview.ts';

export const GET: APIRoute = async () => {
  const edition = await getCurrentEdition();
  const png = await renderLinkPreview(linkPreviewContent(edition));
  return new Response(new Uint8Array(png), {
    headers: {
      'Content-Type': 'image/png',
      'Cache-Control': 'public, max-age=604800',
    },
  });
};
