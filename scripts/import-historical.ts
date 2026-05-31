// scripts/import-historical.ts
// One-off, idempotent import of replay-1 + replay-2 history into Supabase.
// Run: npm run import:historical [-- --dry-run]
// Requires scripts/.env (or process env) with SUPABASE_URL + SUPABASE_SERVICE_KEY.
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { parseCsv } from './lib/csv';
import {
  mapReplay1Registration,
  mapReplay2Registration,
  mapReplay2Order,
  type EditionPricing,
  type UserUpsert,
  type RegistrationInsert,
  type OrderInsert,
  type PaymentStatus,
} from './lib/mappers';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = resolve(__dirname, 'data');
const DRY_RUN = process.argv.includes('--dry-run');
const ALLOWED_SLUGS = ['replay-1', 'replay-2'] as const;

const REPLAY2_PRICING: EditionPricing = {
  oneshot: { day1: 800, day2: 800 },
  campaign: 1400,
  adventurer_cap: 1000,
};

function loadEnv(): void {
  const envPath = resolve(__dirname, '.env');
  if (!existsSync(envPath)) return;
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (!m) continue;
    let val = m[2];
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (!(m[1] in process.env)) process.env[m[1]] = val;
  }
}

function readCsv(file: string): Record<string, string>[] {
  const path = resolve(DATA_DIR, file);
  if (!existsSync(path)) {
    console.error(`Missing CSV: ${path}`);
    process.exit(1);
  }
  return parseCsv(readFileSync(path, 'utf8'));
}

// Merge user records by phone, keeping the first non-empty name/email seen.
function mergeUsers(target: Map<string, UserUpsert>, users: UserUpsert[]): void {
  for (const u of users) {
    const existing = target.get(u.phone);
    if (!existing) {
      target.set(u.phone, { ...u });
    } else {
      if (!existing.name && u.name) existing.name = u.name;
      if (!existing.email && u.email) existing.email = u.email;
    }
  }
}

function statusSplit(items: { payment_status: PaymentStatus }[]): string {
  const c = { confirmed: 0, cancelled: 0, pending: 0 };
  for (const it of items) c[it.payment_status]++;
  return `confirmed=${c.confirmed} cancelled=${c.cancelled} pending=${c.pending}`;
}

async function upsertUsers(sb: SupabaseClient, users: Map<string, UserUpsert>): Promise<void> {
  const rows = [...users.values()];
  if (rows.length === 0) return;
  const { error } = await sb.from('users').upsert(rows, { onConflict: 'phone' });
  if (error) throw new Error(`users upsert: ${error.message}`);
}

async function reloadRegistrations(
  sb: SupabaseClient,
  editionId: string,
  regs: RegistrationInsert[],
): Promise<void> {
  const del = await sb.from('registrations').delete().eq('edition_id', editionId);
  if (del.error) throw new Error(`registrations delete: ${del.error.message}`);
  if (regs.length === 0) return;
  const rows = regs.map((r) => ({ ...r, edition_id: editionId }));
  const { error } = await sb.from('registrations').insert(rows);
  if (error) throw new Error(`registrations insert: ${error.message}`);
}

async function reloadOrders(
  sb: SupabaseClient,
  editionId: string,
  orders: OrderInsert[],
): Promise<void> {
  const del = await sb.from('orders').delete().eq('edition_id', editionId);
  if (del.error) throw new Error(`orders delete: ${del.error.message}`);
  if (orders.length === 0) return;
  const rows = orders.map((o) => ({ ...o, edition_id: editionId }));
  const { error } = await sb.from('orders').insert(rows);
  if (error) throw new Error(`orders insert: ${error.message}`);
}

async function main(): Promise<void> {
  loadEnv();
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) {
    console.error('Missing SUPABASE_URL / SUPABASE_SERVICE_KEY (set scripts/.env).');
    process.exit(1);
  }
  const sb = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

  // Resolve historical edition ids by slug (guard: only these slugs are touched).
  const { data: eds, error } = await sb.from('editions').select('id, slug').in('slug', ALLOWED_SLUGS as unknown as string[]);
  if (error) throw new Error(`editions lookup: ${error.message}`);
  const idBySlug = new Map((eds ?? []).map((e: any) => [e.slug, e.id as string]));
  for (const slug of ALLOWED_SLUGS) {
    if (!idBySlug.has(slug)) {
      console.error(`Edition ${slug} not found. Apply supabase/seeds/replay-1-2.sql first.`);
      process.exit(1);
    }
  }

  console.log(DRY_RUN ? '== DRY RUN (no writes) ==' : '== LIVE IMPORT ==');

  // ---- Parse all CSVs ----
  const r1Rows = readCsv('replay-1-registrations.csv');
  const r2Rows = readCsv('replay-2-registrations.csv');
  const r2OrderRows = readCsv('replay-2-preorders.csv');

  const users = new Map<string, UserUpsert>();
  const skipped: string[] = [];

  // replay-1 registrations
  const r1Regs: RegistrationInsert[] = [];
  const r1Users: UserUpsert[] = [];
  r1Rows.forEach((row, idx) => {
    const m = mapReplay1Registration(row);
    if (!m) { skipped.push(`replay-1 reg line ${idx + 2}: bad phone "${row['Phone Number']}"`); return; }
    r1Users.push(m.user);
    r1Regs.push(m.registration);
  });
  mergeUsers(users, r1Users);

  // replay-2 registrations
  const r2Regs: RegistrationInsert[] = [];
  const r2Users: UserUpsert[] = [];
  r2Rows.forEach((row, idx) => {
    const m = mapReplay2Registration(row, REPLAY2_PRICING);
    if (!m) { skipped.push(`replay-2 reg line ${idx + 2}: bad phone "${row['Phone']}"`); return; }
    r2Users.push(m.user);
    r2Regs.push(m.registration);
  });
  mergeUsers(users, r2Users);

  // replay-2 orders
  const r2Orders: OrderInsert[] = [];
  const r2OrderUsers: UserUpsert[] = [];
  r2OrderRows.forEach((row, idx) => {
    try {
      const m = mapReplay2Order(row);
      if (!m) { skipped.push(`replay-2 order line ${idx + 2}: bad phone "${row['Phone']}"`); return; }
      r2OrderUsers.push(m.user);
      r2Orders.push(m.order);
    } catch (e) {
      skipped.push(`replay-2 order line ${idx + 2}: ${(e as Error).message}`);
    }
  });
  mergeUsers(users, r2OrderUsers);

  // ---- Summary ----
  console.log(`\nParsed:`);
  console.log(`  users (deduped):        ${users.size}`);
  console.log(`  replay-1 registrations: ${r1Regs.length} (${statusSplit(r1Regs)})`);
  console.log(`  replay-2 registrations: ${r2Regs.length} (${statusSplit(r2Regs)})`);
  console.log(`  replay-2 orders:        ${r2Orders.length} (${statusSplit(r2Orders)})`);
  if (skipped.length) {
    console.log(`\nSkipped ${skipped.length} row(s):`);
    for (const s of skipped) console.log(`  - ${s}`);
  }

  if (DRY_RUN) {
    console.log('\nDry run complete — no rows written.');
    return;
  }

  // ---- Write ----
  await upsertUsers(sb, users);
  await reloadRegistrations(sb, idBySlug.get('replay-1')!, r1Regs);
  await reloadRegistrations(sb, idBySlug.get('replay-2')!, r2Regs);
  await reloadOrders(sb, idBySlug.get('replay-2')!, r2Orders);

  console.log('\nImport complete.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
