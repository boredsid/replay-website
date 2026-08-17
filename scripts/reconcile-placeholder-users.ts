// Read-only candidate matcher for synthetic REPLAY users. It compares against
// real-phone REPLAY users and, when provided, a BGC JSON export containing
// objects with name, phone, and email fields.
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';

const scriptDir = dirname(fileURLToPath(import.meta.url));

function loadEnv(path: string): void {
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (!match || match[1] in process.env) continue;
    const raw = match[2];
    process.env[match[1]] = ((raw.startsWith('"') && raw.endsWith('"')) || (raw.startsWith("'") && raw.endsWith("'")))
      ? raw.slice(1, -1)
      : raw;
  }
}

function normalizeName(value: unknown): string {
  return String(value ?? '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .sort()
    .join(' ');
}

function levenshtein(a: string, b: string): number {
  const previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i += 1) {
    let diagonal = previous[0];
    previous[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const above = previous[j];
      previous[j] = Math.min(
        previous[j] + 1,
        previous[j - 1] + 1,
        diagonal + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
      diagonal = above;
    }
  }
  return previous[b.length];
}

function similarity(a: string, b: string): number {
  if (!a || !b) return 0;
  if (a === b) return 1;
  return 1 - levenshtein(a, b) / Math.max(a.length, b.length);
}

type Person = {
  source: 'replay' | 'bgc';
  name: string;
  phone: string;
  email: string | null;
};

loadEnv(resolve(scriptDir, '.env'));
const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_KEY;
if (!url || !key) throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_KEY in scripts/.env.');

const sb = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
const { data: replayUsers, error } = await sb.from('users').select('name,phone,email').range(0, 9999);
if (error) throw new Error(`REPLAY users: ${error.message}`);

const candidates: Person[] = (replayUsers ?? [])
  .filter((user) => !/^00000000\d{2}$/.test(String(user.phone)))
  .map((user) => ({
    source: 'replay',
    name: String(user.name ?? ''),
    phone: String(user.phone),
    email: user.email ? String(user.email) : null,
  }));

const bgcDataPath = process.env.BGC_DATA_PATH;
if (bgcDataPath) {
  const raw = JSON.parse(readFileSync(resolve(bgcDataPath), 'utf8'));
  const rows = Array.isArray(raw) ? raw : raw.users;
  if (!Array.isArray(rows)) throw new Error('BGC_DATA_PATH must contain an array or { users: [] }.');
  for (const row of rows) {
    const phone = String(row.phone ?? '').replace(/\D/g, '').slice(-10);
    if (!/^\d{10}$/.test(phone)) continue;
    candidates.push({
      source: 'bgc',
      name: String(row.name ?? ''),
      phone,
      email: row.email ? String(row.email).trim().toLowerCase() : null,
    });
  }
}

const placeholders = (replayUsers ?? [])
  .filter((user) => /^00000000\d{2}$/.test(String(user.phone)))
  .map((user) => ({ name: String(user.name ?? ''), phone: String(user.phone) }));

const report = placeholders.map((placeholder) => {
  const normalized = normalizeName(placeholder.name);
  const matches = candidates
    .map((candidate) => ({
      ...candidate,
      score: Number(similarity(normalized, normalizeName(candidate.name)).toFixed(3)),
    }))
    .filter((candidate) => candidate.score >= 0.6)
    .sort((a, b) => b.score - a.score || a.source.localeCompare(b.source) || a.name.localeCompare(b.name));
  return {
    placeholder,
    exact_matches: matches.filter((candidate) => candidate.score === 1),
    fuzzy_candidates: matches.filter((candidate) => candidate.score < 1).slice(0, 5),
  };
});

console.log(JSON.stringify({
  sources: {
    replay: candidates.filter((candidate) => candidate.source === 'replay').length,
    bgc: candidates.filter((candidate) => candidate.source === 'bgc').length,
  },
  placeholders: report,
}, null, 2));
