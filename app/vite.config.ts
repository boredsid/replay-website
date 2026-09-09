import { defineConfig, type Plugin } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';

const WORKER_URL = (process.env.VITE_WORKER_URL ?? 'https://api.replaycon.in').replace(/\/$/, '');
const VIRTUAL_ID = 'virtual:game-catalogue';
const RESOLVED_ID = `\0${VIRTUAL_ID}`;
const EMPTY = { generatedAt: '', sources: [], games: [] };

/**
 * Bakes the game catalogue into the bundle.
 *
 * The catalogue used to be a committed JSON file imported straight out of the
 * site's tree. It now lives in the database, where the admin console can edit
 * it, so the app fetches it once per build and ships the result — the shelf
 * still has to list on venue wifi and offline, which a runtime fetch cannot
 * promise on a first open with no signal.
 *
 * It reads the public `/api/catalogue` rather than Supabase because the app's
 * deploy workflow carries no database credentials, and giving it some to read
 * what is already on a public page would be the worse trade.
 *
 * A *virtual* module rather than a generated file, deliberately. A file on disk
 * would have to exist before `npm run check:app` could typecheck the import,
 * and that runs before `build:app` both in CI and on a fresh clone — so the
 * first typecheck of a new checkout would fail on a file nothing had generated
 * yet. Nothing needs to exist for this.
 *
 * A build **fails** if the catalogue cannot be fetched, following the sponsor
 * normaliser's rule: an app shipped with an empty library is worse than a
 * stopped build. A dev server and the test run warn and carry on with nothing,
 * because neither is shipping anything.
 */
function catalogue(): Plugin {
  let cached: Promise<unknown> | null = null;
  let isBuild = false;

  return {
    name: 'replay-game-catalogue',
    configResolved(config) {
      isBuild = config.command === 'build';
    },
    resolveId(id) {
      return id === VIRTUAL_ID ? RESOLVED_ID : null;
    },
    async load(id) {
      if (id !== RESOLVED_ID) return null;
      // Tests never reach for the network: the catalogue is not what any of
      // them is about, and a suite that fails when BGG's host is slow is a
      // suite nobody trusts.
      if (process.env.VITEST) return `export default ${JSON.stringify(EMPTY)}`;

      cached ??= (async () => {
        const response = await fetch(`${WORKER_URL}/api/catalogue`);
        if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
        const snapshot = (await response.json()) as { games?: unknown[] };
        if (!Array.isArray(snapshot.games)) throw new Error('no games in the response');
        console.log(`[catalogue] ${snapshot.games.length} games from ${WORKER_URL}`);
        return snapshot;
      })();

      try {
        return `export default ${JSON.stringify(await cached)}`;
      } catch (error) {
        cached = null;
        const why = `[catalogue] could not read ${WORKER_URL}/api/catalogue: ${(error as Error).message}`;
        if (isBuild) throw new Error(why);
        console.warn(`${why} — the library will be empty`);
        return `export default ${JSON.stringify(EMPTY)}`;
      }
    },
  };
}

export default defineConfig({
  root: resolve(__dirname),
  plugins: [react(), catalogue()],
  // `src/lib/venue-map` still lives at the repo root, shared with the public
  // site, so the dev server has to be allowed to read above the app's own root.
  server: { fs: { allow: [resolve(__dirname, '..')] } },
  publicDir: resolve(__dirname, 'public'),
  build: {
    outDir: resolve(__dirname, 'dist'),
    emptyOutDir: true,
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test-setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
    css: false,
  },
});
