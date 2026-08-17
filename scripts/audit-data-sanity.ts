// Read-only production data audit. Prints aggregate anomaly counts and the
// explicitly requested list of users missing email addresses.
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';

const scriptDir = dirname(fileURLToPath(import.meta.url));

function loadEnv(): void {
  const path = resolve(scriptDir, '.env');
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

loadEnv();
const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_KEY;
if (!url || !key) throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_KEY in scripts/.env.');

const sb = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

async function read(table: string, columns: string): Promise<any[]> {
  const { data, error } = await sb.from(table).select(columns).range(0, 9999);
  if (error) throw new Error(`${table}: ${error.message}`);
  return data ?? [];
}

const [users, editions, registrations, orders, products, schedule, leads] = await Promise.all([
  read('users', 'phone,name,email'),
  read('editions', 'id,slug,start_date,end_date,daily_start_time,daily_end_time,capacity_per_day,pricing,registration_status,is_current,is_published'),
  read('registrations', 'id,user_phone,edition_id,pass_type,days,seats,amount_paid,discount_applied,payment_status,created_at'),
  read('orders', 'id,user_phone,edition_id,total,payment_status'),
  read('products', 'id,edition_id,mrp,reselling_price,stock'),
  read('schedule_items', 'id,edition_id,day,start_time,end_time'),
  read('leads', 'id,edition_id,phone,converted_at'),
]);

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const missingEmails = users
  .filter((user) => !String(user.email ?? '').trim())
  .map((user) => ({ phone: user.phone, name: user.name ?? '' }))
  .sort((a, b) => String(a.name).localeCompare(String(b.name)) || String(a.phone).localeCompare(String(b.phone)));
const malformedEmails = users.filter((user) => user.email && !emailPattern.test(String(user.email).trim()));
const malformedPhones = users.filter((user) => !/^\d{10}$/.test(String(user.phone)));
const missingNames = users.filter((user) => !String(user.name ?? '').trim());
const syntheticPhones = users.filter((user) => /^00000000\d{2}$/.test(String(user.phone)));
const emailNormalizationIssues = users.filter((user) => user.email && String(user.email) !== String(user.email).trim().toLowerCase());
const emailCounts = new Map<string, number>();
for (const user of users) {
  const email = String(user.email ?? '').trim().toLowerCase();
  if (email) emailCounts.set(email, (emailCounts.get(email) ?? 0) + 1);
}
const duplicateEmails = [...emailCounts.entries()].filter(([, count]) => count > 1).map(([email, count]) => ({ email, count }));
const userPhonesWithActivity = new Set([
  ...registrations.map((registration) => registration.user_phone),
  ...orders.map((order) => order.user_phone),
  ...leads.map((lead) => lead.phone),
]);

const editionById = new Map(editions.map((edition) => [edition.id, edition]));
const userByPhone = new Map(users.map((user) => [user.phone, user]));
const invalidRegistrations = registrations.filter((registration) => {
  const days = Array.isArray(registration.days) ? registration.days : [];
  const knownDays = days.length > 0 && days.every((day: string) => day === 'day1' || day === 'day2');
  const passDaysMatch = registration.pass_type === 'oneshot'
    ? days.length === 1
    : registration.pass_type === 'campaign' && days.length === 2 && days.includes('day1') && days.includes('day2');
  return !knownDays || !passDaysMatch || registration.seats < 1 || registration.amount_paid < 0 || registration.discount_applied < 0;
});

const capacityOverages: Array<{ slug: string; day: string; reserved: number; capacity: number }> = [];
for (const edition of editions) {
  for (const day of ['day1', 'day2']) {
    const capacity = Number(edition.capacity_per_day?.[day]);
    if (!Number.isFinite(capacity)) continue;
    const reserved = registrations
      .filter((registration) => registration.edition_id === edition.id
        && (registration.payment_status === 'pending' || registration.payment_status === 'confirmed')
        && registration.days?.includes(day))
      .reduce((sum, registration) => sum + Number(registration.seats || 0), 0);
    if (reserved > capacity) capacityOverages.push({ slug: edition.slug, day, reserved, capacity });
  }
}

const scheduleIssues = schedule.filter((item) => {
  const edition = editionById.get(item.edition_id);
  return !edition || item.day < edition.start_date || item.day > edition.end_date || item.end_time <= item.start_time;
});
const activeEditionShapeIssues = editions.filter((edition) => {
  if (edition.registration_status === 'closed') return false;
  const start = Date.parse(`${edition.start_date}T00:00:00Z`);
  const end = Date.parse(`${edition.end_date}T00:00:00Z`);
  const priceKeys = Object.keys(edition.pricing?.oneshot ?? {}).sort().join(',');
  const capacityKeys = Object.keys(edition.capacity_per_day ?? {}).sort().join(',');
  return end - start !== 86_400_000 || priceKeys !== 'day1,day2' || capacityKeys !== 'day1,day2'
    || !Number.isFinite(edition.pricing?.campaign);
});

const summary = {
  totals: {
    users: users.length,
    registrations: registrations.length,
    orders: orders.length,
    products: products.length,
    schedule_items: schedule.length,
    leads: leads.length,
  },
  anomaly_counts: {
    missing_email: missingEmails.length,
    missing_name: missingNames.length,
    malformed_nonempty_email: malformedEmails.length,
    malformed_phone: malformedPhones.length,
    synthetic_placeholder_phone: syntheticPhones.length,
    email_normalization_issue: emailNormalizationIssues.length,
    duplicate_nonempty_email: duplicateEmails.length,
    users_without_registration_order_or_lead: users.filter((user) => !userPhonesWithActivity.has(user.phone)).length,
    invalid_registration: invalidRegistrations.length,
    negative_order_total: orders.filter((order) => order.total < 0).length,
    invalid_product_values: products.filter((product) => product.mrp < 0 || product.reselling_price < 0 || (product.stock != null && product.stock < 0)).length,
    schedule_issue: scheduleIssues.length,
    active_edition_shape_issue: activeEditionShapeIssues.length,
    invalid_daily_event_hours: editions.filter((edition) => !edition.daily_start_time || !edition.daily_end_time || edition.daily_end_time <= edition.daily_start_time).length,
    capacity_overage: capacityOverages.length,
    current_published_editions: editions.filter((edition) => edition.is_current && edition.is_published).length,
    pending_registrations: registrations.filter((registration) => registration.payment_status === 'pending').length,
  },
  duplicate_emails: duplicateEmails,
  pending_registrations: registrations
    .filter((registration) => registration.payment_status === 'pending')
    .map((registration) => ({
      id: registration.id,
      edition: editionById.get(registration.edition_id)?.slug ?? registration.edition_id,
      phone: registration.user_phone,
      name: userByPhone.get(registration.user_phone)?.name ?? '',
      amount_paid: registration.amount_paid,
      created_at: registration.created_at,
    })),
  capacity_overages: capacityOverages,
  users_missing_email: missingEmails,
};

console.log(JSON.stringify(summary, null, 2));
