// Adds a short blurb to each game in `src/data/game-library.json`.
//
// Separate from `sync:library` on purpose. That script does a five-source merge
// and rebuilds the whole snapshot; this one only fills in a single field, so it
// can be re-run safely, resumed after a failure, and skipped entirely without
// breaking anything — `description` is optional on `LibraryGame`.
//
// Why the text is trimmed: BGG descriptions average about 1,600 characters, so
// the full set is roughly 900KB. That would take the attendee app's catalogue
// chunk from 48KB gzipped to around 300KB, paid on first open, on venue wifi,
// by everyone — including the many people who never open the library at all.
// Three hundred characters is enough to know whether you want the box.
//
//   npm run sync:descriptions

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import type { LibrarySnapshot } from '../src/lib/game-library';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const SNAPSHOT = join(root, 'src/data/game-library.json');

const MAX_CHARS = 300;
/** Politeness, not throughput: this is somebody else's server. */
const CONCURRENCY = 4;
const PAUSE_MS = 120;

/** BGG returns HTML with numeric entities. Neither belongs in a phone list. */
function plainText(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCharCode(Number(code)))
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Trims on a sentence if one is close to the limit, else on a word. */
function trim(text: string): string {
  if (text.length <= MAX_CHARS) return text;
  const cut = text.slice(0, MAX_CHARS);
  const sentence = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('! '), cut.lastIndexOf('? '));
  if (sentence > MAX_CHARS * 0.6) return cut.slice(0, sentence + 1);
  const word = cut.lastIndexOf(' ');
  return `${cut.slice(0, word > 0 ? word : MAX_CHARS)}…`;
}

async function describe(bggId: number): Promise<string | null> {
  try {
    const response = await fetch(
      `https://api.geekdo.com/api/geekitems?objectid=${bggId}&objecttype=thing&subtype=boardgame`,
      { headers: { accept: 'application/json' } },
    );
    if (!response.ok) return null;
    const body = await response.json() as { item?: { description?: string; short_description?: string } };
    const raw = body.item?.short_description || body.item?.description || '';
    const text = plainText(String(raw));
    return text.length > 0 ? trim(text) : null;
  } catch {
    return null;
  }
}

const snapshot = JSON.parse(readFileSync(SNAPSHOT, 'utf8')) as LibrarySnapshot;
const games = snapshot.games;

// Only the ones still missing one, so a re-run after a network wobble picks up
// where it stopped rather than starting the whole shelf again.
const todo = games.filter((game) => game.bggId !== null && !game.description);
console.log(`${games.length} games, ${todo.length} without a blurb.`);

let done = 0;
let found = 0;
for (let i = 0; i < todo.length; i += CONCURRENCY) {
  const batch = todo.slice(i, i + CONCURRENCY);
  const results = await Promise.all(batch.map((game) => describe(game.bggId as number)));
  results.forEach((text, index) => {
    if (text) { batch[index].description = text; found += 1; }
  });
  done += batch.length;

  // Written as we go: 586 requests is several minutes, and losing all of it to
  // one failure at game 500 would be its own reason not to run this again.
  if (i % 40 === 0 || done === todo.length) {
    writeFileSync(SNAPSHOT, `${JSON.stringify(snapshot, null, 2)}\n`);
    console.log(`  ${done}/${todo.length} (${found} found)`);
  }
  await new Promise((resolve) => setTimeout(resolve, PAUSE_MS));
}

writeFileSync(SNAPSHOT, `${JSON.stringify(snapshot, null, 2)}\n`);

const withText = games.filter((game) => game.description).length;
const chars = games.reduce((sum, game) => sum + (game.description?.length ?? 0), 0);
console.log(`Done: ${withText}/${games.length} have a blurb, ${(chars / 1024).toFixed(0)}KB of text.`);
