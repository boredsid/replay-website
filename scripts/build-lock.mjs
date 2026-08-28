/**
 * Serialises `astro build` so two builds can never share one `dist/`.
 *
 * Astro empties `dist/.prerender/` at the start of every prerender bundle and
 * writes content-hashed chunks into it. It then records the entry filename and,
 * during "generating static routes", `import()`s that absolute path — pulling in
 * each page's chunk lazily, as the route is rendered. So the directory has to
 * stay exactly as that build left it for as long as rendering takes.
 *
 * `/link-preview.png` renders through sharp and holds that window open for
 * ~15 seconds. A second `astro build` starting anywhere in that window wipes
 * `dist/.prerender/` and rewrites it with different hashes, and the first build
 * dies on the next route it renders:
 *
 *     Cannot find module 'dist/.prerender/chunks/<page>_<hash>.mjs'
 *
 * The failing page varies with whichever route happened to be next, which is
 * what made this look like a bundler race rather than two builds colliding.
 * Measured: six serial builds in an isolated checkout passed; two deliberately
 * concurrent ones reproduced the error on the first try.
 *
 * This repo invites the collision — parallel agent sessions and worktrees share
 * one checkout, and each may run `npm run build`. The lock does not queue the
 * second build; it refuses it, immediately and loudly, because a developer
 * waiting on a silent lock is worse than one told what is already running.
 *
 * Plain `.mjs`, not `.ts` like its neighbours in this folder: it wraps the build
 * itself, so it must not depend on `tsx` being resolvable to run.
 *
 * Set REPLAY_SKIP_BUILD_LOCK=1 to bypass (CI runs in a fresh container where no
 * second build can exist, so the lock is inert there either way).
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
// Deliberately outside `dist/`: the build's own `rm -rf dist` would delete a
// lock kept in there, releasing it while the build is still running.
const LOCK = path.join(repoRoot, 'node_modules', '.cache', 'replay-build.lock');

/** True when a process is alive; signal 0 tests without delivering anything. */
function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM means it exists but belongs to another user — still a live build.
    return error.code === 'EPERM';
  }
}

function readHolder() {
  try {
    return JSON.parse(fs.readFileSync(LOCK, 'utf-8'));
  } catch {
    return null;
  }
}

/**
 * Take the lock, or return the live holder. `wx` fails if the path exists, and
 * that check-and-create is atomic, so two builds racing here cannot both win.
 */
function acquire() {
  fs.mkdirSync(path.dirname(LOCK), { recursive: true });
  const payload = JSON.stringify({ pid: process.pid, started: new Date().toISOString() });
  try {
    fs.writeFileSync(LOCK, payload, { flag: 'wx' });
    return null;
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
  }

  // A lock file exists. If the build that wrote it is gone — killed, crashed,
  // or the machine rebooted mid-build — the lock is stale and we take it over.
  const holder = readHolder();
  if (holder && Number.isInteger(holder.pid) && alive(holder.pid)) {
    return holder;
  }
  fs.writeFileSync(LOCK, payload);
  return null;
}

if (process.env.REPLAY_SKIP_BUILD_LOCK === '1') {
  run();
} else {
  const holder = acquire();
  if (holder) {
    const since = holder.started ? ` (started ${holder.started})` : '';
    console.error(
      `\n[build-lock] Another build is already running in this checkout: pid ${holder.pid}${since}.\n` +
        '[build-lock] Two builds share one dist/ and corrupt each other mid-render, so this one is\n' +
        '[build-lock] stopping instead. Wait for that build, or stop it, then try again.\n' +
        `[build-lock] If nothing is really running, delete ${path.relative(repoRoot, LOCK)}.\n`,
    );
    process.exit(1);
  }
  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    // Only remove our own lock — never one a takeover handed to someone else.
    const current = readHolder();
    if (!current || current.pid === process.pid) fs.rmSync(LOCK, { force: true });
  };
  process.on('exit', release);
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
    process.on(signal, () => {
      release();
      process.exit(1);
    });
  }
  run();
}

function run() {
  // `astro` rather than `npm run`: re-entering npm here would recurse back into
  // this wrapper. Args after the script name pass straight through.
  const astro = path.join(repoRoot, 'node_modules', '.bin', 'astro');
  const child = spawn(astro, ['build', ...process.argv.slice(2)], { stdio: 'inherit' });
  child.on('exit', (code, signal) => process.exit(signal ? 1 : (code ?? 1)));
  child.on('error', (error) => {
    console.error(`[build-lock] could not start astro: ${error.message}`);
    process.exit(1);
  });
}
