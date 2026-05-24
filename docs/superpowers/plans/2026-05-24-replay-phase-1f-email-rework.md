# Phase 1F — Registration Email Rework Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Apply Phase 1E bgc-aligned visual identity to `src/emails/registration.html`, add four content blocks (what to expect / add to calendar / schedule + venue / share + social footer), and fix the pre-existing `{{edition_name}}` rendering bug so emails display "REPLAY 3rd edition" end-to-end.

**Architecture:** Pure-function additions to the Cloudflare Worker (`format.ts`, `calendar.ts`) feed new placeholder values into the existing email payload. A new `GET /api/ics/:slug.ics` worker endpoint generates per-edition iCalendar files referenced by the email. The Apps Script template fetcher continues dumb substitution — no GAS changes. Template rewrite is a single-file replacement.

**Tech Stack:** Cloudflare Workers (TypeScript), Vitest, Supabase JS client, plain HTML/inline-CSS email.

**Spec:** `docs/superpowers/specs/2026-05-24-replay-phase-1f-email-rework-design.md`

---

## File Structure

| File | Status | Responsibility |
|---|---|---|
| `worker/src/format.ts` | NEW | Display-string helpers (starts with `editionOrdinal`) |
| `worker/src/format.test.ts` | NEW | Unit tests for format helpers |
| `worker/src/calendar.ts` | NEW | Google Calendar + WhatsApp URL builders |
| `worker/src/calendar.test.ts` | NEW | Unit tests for URL builders |
| `worker/src/ics.ts` | NEW | `GET /api/ics/:slug.ics` handler |
| `worker/src/ics.test.ts` | NEW | Endpoint tests (200/404/MIME/cache/body shape) |
| `worker/src/index.ts` | MODIFY | Register new route |
| `worker/src/register.ts` | MODIFY | Use display name + append new variables to payload |
| `worker/src/register.test.ts` | MODIFY | Assert new payload keys + new subject shape |
| `src/emails/registration.html` | REWRITE | Visual reskin + 4 new content blocks + new placeholders |

Worker tasks are TDD red-green. Email template is a single rewrite task with manual visual verification.

---

## Task 1: `editionOrdinal` helper in worker

**Files:**
- Create: `worker/src/format.ts`
- Create: `worker/src/format.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `worker/src/format.test.ts`:

```typescript
import { describe, expect, it } from 'vitest';
import { editionOrdinal } from './format';

describe('editionOrdinal', () => {
  it('returns "1st edition" for replay-1', () => {
    expect(editionOrdinal('replay-1')).toBe('1st edition');
  });
  it('returns "2nd edition" for replay-2', () => {
    expect(editionOrdinal('replay-2')).toBe('2nd edition');
  });
  it('returns "3rd edition" for replay-3', () => {
    expect(editionOrdinal('replay-3')).toBe('3rd edition');
  });
  it('returns "4th edition" for replay-4', () => {
    expect(editionOrdinal('replay-4')).toBe('4th edition');
  });
  it('returns "21st edition" for replay-21', () => {
    expect(editionOrdinal('replay-21')).toBe('21st edition');
  });
  it('returns empty string for malformed slug', () => {
    expect(editionOrdinal('bogus')).toBe('');
    expect(editionOrdinal('')).toBe('');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd worker && npx vitest run src/format.test.ts`
Expected: FAIL — `Cannot find module './format'`

- [ ] **Step 3: Implement `format.ts`**

Create `worker/src/format.ts` (ported verbatim from `src/lib/data.ts:8-15`):

```typescript
// worker/src/format.ts
// Pure display-string helpers used to render values in user-facing
// surfaces (currently: email templates). No I/O.

/** "replay-3" → "3rd edition", "replay-21" → "21st edition". Empty string if slug doesn't match. */
export function editionOrdinal(slug: string): string {
  const n = parseInt(String(slug).replace(/^replay-/, ''), 10);
  if (!Number.isFinite(n)) return '';
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  const suffix = s[(v - 20) % 10] || s[v] || s[0];
  return `${n}${suffix} edition`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd worker && npx vitest run src/format.test.ts`
Expected: PASS (6 tests)

- [ ] **Step 5: Commit**

```bash
git add worker/src/format.ts worker/src/format.test.ts
git commit -m "$(cat <<'EOF'
worker: add editionOrdinal display helper

Ports editionOrdinal from src/lib/data.ts into the worker so email
payloads can render "REPLAY 3rd edition" instead of just "REPLAY".

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Calendar URL builders

**Files:**
- Create: `worker/src/calendar.ts`
- Create: `worker/src/calendar.test.ts`

Convention hours are hardcoded: 10:00 IST start → 04:30 UTC, 19:00 IST end → 13:30 UTC. Edition dates are `YYYY-MM-DD` strings; helpers convert to `YYYYMMDDTHHMMSSZ`.

- [ ] **Step 1: Write the failing tests**

Create `worker/src/calendar.test.ts`:

```typescript
import { describe, expect, it } from 'vitest';
import { buildGoogleCalendarUrl, buildWhatsAppShareUrl } from './calendar';

const edition = {
  slug: 'replay-3',
  name: 'REPLAY',
  start_date: '2026-09-12',
  end_date: '2026-09-13',
  venue: 'The Foundry, Bangalore',
};

describe('buildGoogleCalendarUrl', () => {
  it('encodes start and end in UTC ISO basic format', () => {
    const url = buildGoogleCalendarUrl(edition);
    expect(url).toContain('dates=20260912T043000Z%2F20260913T133000Z');
  });
  it('URL-encodes the title with ordinal label', () => {
    const url = buildGoogleCalendarUrl(edition);
    expect(url).toContain('text=REPLAY%203rd%20edition');
  });
  it('URL-encodes the venue as location', () => {
    const url = buildGoogleCalendarUrl(edition);
    expect(url).toContain('location=The%20Foundry%2C%20Bangalore');
  });
  it('passes through TBD venue gracefully', () => {
    const tbdEdition = { ...edition, venue: 'TBD' };
    const url = buildGoogleCalendarUrl(tbdEdition);
    expect(url).toContain('location=TBD');
  });
});

describe('buildWhatsAppShareUrl', () => {
  it('includes edition ordinal name and site URL in prefilled text', () => {
    const url = buildWhatsAppShareUrl(edition);
    expect(url.startsWith('https://wa.me/?text=')).toBe(true);
    const text = decodeURIComponent(url.split('text=')[1]);
    expect(text).toContain('REPLAY 3rd edition');
    expect(text).toContain('replaycon.in');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd worker && npx vitest run src/calendar.test.ts`
Expected: FAIL — `Cannot find module './calendar'`

- [ ] **Step 3: Implement `calendar.ts`**

Create `worker/src/calendar.ts`:

```typescript
// worker/src/calendar.ts
// Pure URL builders for the email's "add to calendar" + "share" CTAs.
import { editionOrdinal } from './format';

interface EditionLike {
  slug: string;
  name: string;
  start_date: string;
  end_date: string;
  venue: string;
}

// Convention runs 10:00–19:00 IST. IST is UTC+05:30, so:
//   10:00 IST → 04:30 UTC, 19:00 IST → 13:30 UTC.
function toUtcBasic(dateIso: string, time: 'start' | 'end'): string {
  const t = time === 'start' ? '043000Z' : '133000Z';
  return `${dateIso.replace(/-/g, '')}T${t}`;
}

function displayName(edition: EditionLike): string {
  const ord = editionOrdinal(edition.slug);
  return ord ? `REPLAY ${ord}` : 'REPLAY';
}

export function buildGoogleCalendarUrl(edition: EditionLike): string {
  const dates = `${toUtcBasic(edition.start_date, 'start')}/${toUtcBasic(edition.end_date, 'end')}`;
  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: displayName(edition),
    dates,
    details: `Bangalore board-game convention. Tickets + schedule: https://replaycon.in`,
    location: edition.venue,
  });
  // URLSearchParams encodes spaces as +; Google Calendar accepts %20 too,
  // but we use %20 for consistency with the tests + cleaner appearance.
  return `https://calendar.google.com/calendar/render?${params.toString().replace(/\+/g, '%20')}`;
}

export function buildWhatsAppShareUrl(edition: EditionLike): string {
  const text = `Going to ${displayName(edition)} — Bangalore's board-game weekend. Grab a pass at https://replaycon.in`;
  return `https://wa.me/?text=${encodeURIComponent(text)}`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd worker && npx vitest run src/calendar.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add worker/src/calendar.ts worker/src/calendar.test.ts
git commit -m "$(cat <<'EOF'
worker: add calendar + WhatsApp share URL builders

buildGoogleCalendarUrl emits a render?action=TEMPLATE URL with edition
dates in UTC basic ISO, ordinal-aware title, and the venue (gracefully
includes "TBD" while the venue is unset). buildWhatsAppShareUrl emits a
wa.me link with prefilled invite text. Both are pure; tests assert the
exact encoding shape.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: `GET /api/ics/:slug.ics` endpoint

**Files:**
- Create: `worker/src/ics.ts`
- Create: `worker/src/ics.test.ts`

The endpoint serves Apple Mail and Outlook (Google users get the dedicated calendar link). One file → all non-Google clients.

- [ ] **Step 1: Write the failing tests**

Create `worker/src/ics.test.ts`:

```typescript
import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('./supabase', () => ({ serviceClient: vi.fn() }));

import { serviceClient } from './supabase';
import { handleIcsRequest } from './ics';

function mockEnv() {
  return { SUPABASE_URL: 'x', SUPABASE_SERVICE_KEY: 'x' } as any;
}

function mockSupabaseWithEdition(edition: any) {
  return {
    from: (table: string) => {
      if (table === 'editions') {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                maybeSingle: async () => ({ data: edition, error: null }),
              }),
            }),
          }),
        };
      }
      throw new Error('unexpected table ' + table);
    },
  };
}

const replay3 = {
  id: 'e1',
  slug: 'replay-3',
  name: 'REPLAY',
  start_date: '2026-09-12',
  end_date: '2026-09-13',
  venue: 'The Foundry, Bangalore',
};

describe('handleIcsRequest', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 200 with text/calendar MIME for a known slug', async () => {
    (serviceClient as any).mockReturnValue(mockSupabaseWithEdition(replay3));
    const req = new Request('https://api.replaycon.in/api/ics/replay-3.ics');
    const res = await handleIcsRequest(req, mockEnv());
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/calendar');
  });

  it('returns a body with VEVENT and ordinal-aware summary', async () => {
    (serviceClient as any).mockReturnValue(mockSupabaseWithEdition(replay3));
    const req = new Request('https://api.replaycon.in/api/ics/replay-3.ics');
    const res = await handleIcsRequest(req, mockEnv());
    const body = await res.text();
    expect(body).toContain('BEGIN:VCALENDAR');
    expect(body).toContain('BEGIN:VEVENT');
    expect(body).toContain('SUMMARY:REPLAY 3rd edition');
    expect(body).toContain('DTSTART:20260912T043000Z');
    expect(body).toContain('DTEND:20260913T133000Z');
    expect(body).toContain('LOCATION:The Foundry\\, Bangalore');
    expect(body).toContain('END:VCALENDAR');
  });

  it('returns 404 for an unknown slug', async () => {
    (serviceClient as any).mockReturnValue(mockSupabaseWithEdition(null));
    const req = new Request('https://api.replaycon.in/api/ics/replay-99.ics');
    const res = await handleIcsRequest(req, mockEnv());
    expect(res.status).toBe(404);
  });

  it('sets a 24h public Cache-Control header', async () => {
    (serviceClient as any).mockReturnValue(mockSupabaseWithEdition(replay3));
    const req = new Request('https://api.replaycon.in/api/ics/replay-3.ics');
    const res = await handleIcsRequest(req, mockEnv());
    expect(res.headers.get('cache-control')).toBe('public, max-age=86400');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd worker && npx vitest run src/ics.test.ts`
Expected: FAIL — `Cannot find module './ics'`

- [ ] **Step 3: Implement `ics.ts`**

Create `worker/src/ics.ts`:

```typescript
// worker/src/ics.ts
// GET /api/ics/:slug.ics — returns an iCalendar VEVENT for the edition.
// Apple Mail + Outlook consume this when opening the email's calendar CTA.
import type { Env } from './index';
import { serviceClient } from './supabase';
import { editionOrdinal } from './format';

interface EditionRow {
  slug: string;
  start_date: string;
  end_date: string;
  venue: string;
  is_published: boolean;
}

function toUtcBasic(dateIso: string, time: 'start' | 'end'): string {
  const t = time === 'start' ? '043000Z' : '133000Z';
  return `${dateIso.replace(/-/g, '')}T${t}`;
}

// iCalendar text values escape commas, semicolons, and backslashes.
function escapeIcsText(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/,/g, '\\,')
    .replace(/;/g, '\\;')
    .replace(/\r?\n/g, '\\n');
}

function nowUtcBasic(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`;
}

export async function handleIcsRequest(req: Request, env: Env): Promise<Response> {
  const url = new URL(req.url);
  const match = url.pathname.match(/^\/api\/ics\/([a-z0-9-]+)\.ics$/);
  if (!match) return new Response('not found', { status: 404 });
  const slug = match[1];

  const sb = serviceClient(env);
  const { data, error } = await sb
    .from('editions')
    .select('slug, start_date, end_date, venue, is_published')
    .eq('slug', slug)
    .eq('is_published', true)
    .maybeSingle();
  if (error) return new Response('error', { status: 500 });
  const edition = data as EditionRow | null;
  if (!edition) return new Response('not found', { status: 404 });

  const ord = editionOrdinal(edition.slug);
  const summary = ord ? `REPLAY ${ord}` : 'REPLAY';
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//replaycon.in//REPLAY//EN',
    'CALSCALE:GREGORIAN',
    'BEGIN:VEVENT',
    `UID:replay-${edition.slug}@replaycon.in`,
    `DTSTAMP:${nowUtcBasic()}`,
    `DTSTART:${toUtcBasic(edition.start_date, 'start')}`,
    `DTEND:${toUtcBasic(edition.end_date, 'end')}`,
    `SUMMARY:${escapeIcsText(summary)}`,
    `LOCATION:${escapeIcsText(edition.venue)}`,
    `DESCRIPTION:${escapeIcsText('Bangalore board-game convention. Tickets + schedule: https://replaycon.in')}`,
    'URL:https://replaycon.in',
    'END:VEVENT',
    'END:VCALENDAR',
  ];
  const body = lines.join('\r\n') + '\r\n';

  return new Response(body, {
    status: 200,
    headers: {
      'content-type': 'text/calendar; charset=utf-8',
      'cache-control': 'public, max-age=86400',
    },
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd worker && npx vitest run src/ics.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add worker/src/ics.ts worker/src/ics.test.ts
git commit -m "$(cat <<'EOF'
worker: add GET /api/ics/:slug.ics endpoint

Returns a minimal iCalendar VEVENT for the requested edition (published
rows only). Apple Mail + Outlook consume this from the email's
"Download .ics" CTA. 24h public cache; 404 for unknown/unpublished
slugs.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Wire ICS route into worker entry

**Files:**
- Modify: `worker/src/index.ts`

- [ ] **Step 1: Add import**

Edit `worker/src/index.ts:7` — add import below the existing `handleLead` import:

```typescript
import { handleIcsRequest } from './ics';
```

- [ ] **Step 2: Add route handler**

Edit `worker/src/index.ts` — inside the try block, between the `/api/lead` route (line 51-53) and the closing `return jsonResponse({ error: 'Not found' }, 404)`:

```typescript
      if (path.startsWith('/api/ics/') && path.endsWith('.ics') && req.method === 'GET') {
        return await handleIcsRequest(req, env);
      }
```

- [ ] **Step 3: Smoke-check the route exists**

Run: `cd worker && npx vitest run`
Expected: ALL existing tests pass; no new tests yet for the route registration (handler tests in Task 3 already cover behaviour).

- [ ] **Step 4: Commit**

```bash
git add worker/src/index.ts
git commit -m "$(cat <<'EOF'
worker: register /api/ics/:slug.ics route

Wires Task 3's handleIcsRequest into the entry router.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Fix `edition_name` + append new variables to email payload

**Files:**
- Modify: `worker/src/register.ts`
- Modify: `worker/src/register.test.ts`

- [ ] **Step 1: Write the failing test**

In `worker/src/register.test.ts`, replace the existing `'guildmaster gets full discount...'` test (currently at line ~156) with this expanded version that asserts the new payload shape. Locate this block:

```typescript
  it('guildmaster gets full discount and confirmed status + email dispatched', async () => {
    (fetchGuildStatus as any).mockResolvedValue({ tier: 'guildmaster', active: true });
    const cap: any = {};
    (serviceClient as any).mockReturnValue(mockSupabase({ existingUser: { phone: '9876543210', name: 'A', email: 'a@b.c' }, capture: cap }));
    const req = new Request('http://x/api/register', { method: 'POST', body: validBody({ pass_type: 'campaign', days: ['day1', 'day2'] }) });
    const res = await handleRegister(req, mockEnv());
    expect(res.status).toBe(200);
    const body: any = await res.json();
    expect(body.final_amount).toBe(0);
    expect(body.discount_applied).toBe(1400);
    expect(body.payment_required).toBe(false);
    expect(cap.reg.payment_status).toBe('confirmed');
    expect(cap.reg.guild_tier_at_purchase).toBe('guildmaster');
    expect(sendEmail).toHaveBeenCalledTimes(1);
  });
```

Replace with:

```typescript
  it('guildmaster gets full discount and confirmed status + email dispatched', async () => {
    (fetchGuildStatus as any).mockResolvedValue({ tier: 'guildmaster', active: true });
    const cap: any = {};
    (serviceClient as any).mockReturnValue(mockSupabase({ existingUser: { phone: '9876543210', name: 'A', email: 'a@b.c' }, capture: cap }));
    const req = new Request('http://x/api/register', { method: 'POST', body: validBody({ pass_type: 'campaign', days: ['day1', 'day2'] }) });
    const res = await handleRegister(req, mockEnv());
    expect(res.status).toBe(200);
    const body: any = await res.json();
    expect(body.final_amount).toBe(0);
    expect(body.discount_applied).toBe(1400);
    expect(body.payment_required).toBe(false);
    expect(cap.reg.payment_status).toBe('confirmed');
    expect(cap.reg.guild_tier_at_purchase).toBe('guildmaster');
    expect(sendEmail).toHaveBeenCalledTimes(1);

    // New payload assertions for Phase 1F.
    const call = (sendEmail as any).mock.calls[0][1];
    expect(call.subject).toBe('REPLAY 3rd edition — registration confirmed');
    expect(call.variables.edition_name).toBe('REPLAY 3rd edition');
    expect(call.variables.calendar_google_url).toContain('calendar.google.com');
    expect(call.variables.calendar_google_url).toContain('text=REPLAY%203rd%20edition');
    expect(call.variables.calendar_ics_url).toBe('https://api.replaycon.in/api/ics/replay-3.ics');
    expect(call.variables.schedule_url).toBe('https://replaycon.in/schedule');
    expect(call.variables.instagram_url).toBe('https://instagram.com/replaycon');
    expect(call.variables.whatsapp_share_url).toMatch(/^https:\/\/wa\.me\/\?text=/);
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd worker && npx vitest run src/register.test.ts -t "guildmaster gets full discount"`
Expected: FAIL — assertion failure on `call.subject` (current value is `'REPLAY REPLAY 3 — registration confirmed'` because mock edition is `name: 'REPLAY 3'` and current code prepends `REPLAY `).

- [ ] **Step 3: Update `register.ts`**

Edit `worker/src/register.ts`:

After the existing imports (line 14), add:

```typescript
import { editionOrdinal } from './format';
import { buildGoogleCalendarUrl, buildWhatsAppShareUrl } from './calendar';
```

Then locate the email block (lines 122-146) and replace the entire `if (amountPaid === 0)` block with:

```typescript
  // Email if zero-payment
  if (amountPaid === 0) {
    try {
      const ord = editionOrdinal(edition.slug);
      const editionDisplayName = (ord ? `REPLAY ${ord}` : 'REPLAY').trim();
      await sendEmail(env, {
        template: 'replay-registration',
        to: email,
        subject: `${editionDisplayName} — registration confirmed`,
        variables: {
          name,
          edition_name: editionDisplayName,
          venue: edition.venue,
          start_date: edition.start_date,
          end_date: edition.end_date,
          pass_type: passType,
          days_label: dayLabel(days),
          seats: 1,
          amount_paid: amountPaid,
          discount_applied: discount,
          guild_tier: tierStored ?? '',
          calendar_google_url: buildGoogleCalendarUrl(edition),
          calendar_ics_url: `https://api.replaycon.in/api/ics/${edition.slug}.ics`,
          schedule_url: 'https://replaycon.in/schedule',
          instagram_url: 'https://instagram.com/replaycon',
          whatsapp_share_url: buildWhatsAppShareUrl(edition),
        },
      });
    } catch (e) {
      // Email failure should not break registration; log and continue.
      console.error('email_failed', e);
    }
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd worker && npx vitest run src/register.test.ts -t "guildmaster gets full discount"`
Expected: PASS

- [ ] **Step 5: Run the full worker test suite**

Run: `cd worker && npx vitest run`
Expected: ALL tests pass (~78 tests: 66 original + 6 format + 5 calendar + 4 ics − 0 + 0 modified; only the rewritten assertions in register.test.ts changed shape, not count). If anything else broke, fix the underlying issue — don't loosen assertions.

- [ ] **Step 6: Commit**

```bash
git add worker/src/register.ts worker/src/register.test.ts
git commit -m "$(cat <<'EOF'
worker: fix edition_name + append calendar/share vars to email payload

Subject + edition_name now render "REPLAY 3rd edition" instead of just
"REPLAY" (or worse: "REPLAY REPLAY" for the subject line). Five new
variables (calendar_google_url, calendar_ics_url, schedule_url,
instagram_url, whatsapp_share_url) feed the new email blocks shipped
in the next commit.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Rewrite the email template

**Files:**
- Rewrite: `src/emails/registration.html`

This is a full-file rewrite. No TDD — visual verification happens in Task 7. Render the new placeholders alongside the existing ones; the template never breaks if a placeholder is missing (GAS substitutes only what's provided).

- [ ] **Step 1: Replace `src/emails/registration.html` with the new content**

Write the entire file:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>{{edition_name}} — registration confirmed</title>
  </head>
  <body style="margin:0;padding:0;background:#FFF8E7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;color:#1A1A1A;-webkit-font-smoothing:antialiased;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#FFF8E7;padding:32px 16px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#FFFFFF;border-radius:16px;overflow:hidden;border:4px solid #1A1A1A;box-shadow:8px 8px 0 #1A1A1A;">

            <!-- Header -->
            <tr>
              <td style="background:#F47B20;color:#FFFFFF;padding:28px 32px;border-bottom:4px solid #1A1A1A;">
                <div style="font-size:12px;letter-spacing:0.18em;text-transform:uppercase;font-weight:700;opacity:0.95;">CONFIRMED · REPLAY</div>
                <div style="font-size:28px;font-weight:800;margin-top:6px;line-height:1.05;letter-spacing:-0.01em;">You're in for {{edition_name}}.</div>
                <div style="margin-top:14px;">
                  <span style="display:inline-block;background:#FFD166;color:#1A1A1A;padding:5px 12px;border-radius:999px;border:2px solid #1A1A1A;font-size:12px;font-weight:700;margin-right:6px;">{{pass_type}}</span>
                  <span style="display:inline-block;background:#FFFFFF;color:#1A1A1A;padding:5px 12px;border-radius:999px;border:2px solid #1A1A1A;font-size:12px;font-weight:700;">{{days_label}}</span>
                </div>
              </td>
            </tr>

            <!-- Hey -->
            <tr>
              <td style="padding:24px 32px 4px 32px;">
                <p style="margin:0 0 14px 0;font-size:16px;line-height:1.5;">Hey {{name}},</p>
                <p style="margin:0 0 16px 0;font-size:16px;line-height:1.5;">Your registration for <strong>{{edition_name}}</strong> is confirmed. See you at {{venue}} on {{days_label}} ({{start_date}} &ndash; {{end_date}}).</p>
              </td>
            </tr>

            <!-- Details table -->
            <tr>
              <td style="padding:4px 32px 20px 32px;">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:3px solid #1A1A1A;border-radius:8px;border-collapse:separate;">
                  <tr>
                    <td style="padding:11px 14px;font-size:14px;border-bottom:2px solid #1A1A1A;width:130px;"><strong>Pass</strong></td>
                    <td style="padding:11px 14px;font-size:14px;border-bottom:2px solid #1A1A1A;">{{pass_type}} &mdash; {{days_label}}</td>
                  </tr>
                  <tr>
                    <td style="padding:11px 14px;font-size:14px;border-bottom:2px solid #1A1A1A;"><strong>Seats</strong></td>
                    <td style="padding:11px 14px;font-size:14px;border-bottom:2px solid #1A1A1A;">{{seats}}</td>
                  </tr>
                  <tr>
                    <td style="padding:11px 14px;font-size:14px;border-bottom:2px solid #1A1A1A;"><strong>Amount paid</strong></td>
                    <td style="padding:11px 14px;font-size:14px;border-bottom:2px solid #1A1A1A;">&#8377;{{amount_paid}}</td>
                  </tr>
                  <tr>
                    <td style="padding:11px 14px;font-size:14px;border-bottom:2px solid #1A1A1A;"><strong>Discount</strong></td>
                    <td style="padding:11px 14px;font-size:14px;border-bottom:2px solid #1A1A1A;">&#8377;{{discount_applied}}</td>
                  </tr>
                  <tr>
                    <td style="padding:11px 14px;font-size:14px;"><strong>Guild Path</strong></td>
                    <td style="padding:11px 14px;font-size:14px;">{{guild_tier}}</td>
                  </tr>
                </table>
              </td>
            </tr>

            <!-- What to expect -->
            <tr>
              <td style="padding:0 32px 14px 32px;">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#FFD166;border:3px solid #1A1A1A;border-radius:8px;">
                  <tr>
                    <td style="padding:14px 16px;">
                      <div style="font-size:11px;letter-spacing:0.16em;text-transform:uppercase;font-weight:700;margin-bottom:6px;">What to expect</div>
                      <div style="font-size:14px;line-height:1.5;">Open play tables · weekend tournaments · publisher demos · food + chai stall</div>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>

            <!-- Add to calendar -->
            <tr>
              <td style="padding:0 32px 14px 32px;">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#A8E6CF;border:3px solid #1A1A1A;border-radius:8px;">
                  <tr>
                    <td style="padding:14px 16px;">
                      <div style="font-size:11px;letter-spacing:0.16em;text-transform:uppercase;font-weight:700;margin-bottom:10px;">Add to calendar</div>
                      <a href="{{calendar_google_url}}" style="display:inline-block;background:#FFFFFF;color:#1A1A1A;padding:8px 14px;border:3px solid #1A1A1A;border-radius:8px;box-shadow:3px 3px 0 #1A1A1A;font-size:13px;font-weight:700;text-decoration:none;margin-right:8px;margin-bottom:6px;">Google Calendar</a>
                      <a href="{{calendar_ics_url}}" style="display:inline-block;background:#FFFFFF;color:#1A1A1A;padding:8px 14px;border:3px solid #1A1A1A;border-radius:8px;box-shadow:3px 3px 0 #1A1A1A;font-size:13px;font-weight:700;text-decoration:none;margin-bottom:6px;">Download .ics</a>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>

            <!-- Schedule + venue -->
            <tr>
              <td style="padding:0 32px 14px 32px;">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#C3A6FF;border:3px solid #1A1A1A;border-radius:8px;">
                  <tr>
                    <td style="padding:14px 16px;">
                      <div style="font-size:11px;letter-spacing:0.16em;text-transform:uppercase;font-weight:700;margin-bottom:6px;">Schedule + venue</div>
                      <div style="font-size:14px;line-height:1.5;">Venue: {{venue}}. We'll mail you again once it's locked in.<br/><a href="{{schedule_url}}" style="color:#1A1A1A;font-weight:700;text-decoration:underline;">View full schedule on replaycon.in &rarr;</a></div>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>

            <!-- Reply note -->
            <tr>
              <td style="padding:6px 32px 20px 32px;font-size:13px;color:#666;line-height:1.5;">
                Reply to this email if anything looks off. &mdash; Team REPLAY
              </td>
            </tr>

            <!-- Share + social footer -->
            <tr>
              <td style="background:#1A1A1A;color:#FFFFFF;padding:18px 32px;border-top:4px solid #1A1A1A;">
                <div style="font-size:13px;line-height:1.6;">
                  <a href="{{whatsapp_share_url}}" style="color:#FFFFFF;text-decoration:underline;font-weight:600;">Bring a friend &rarr; WhatsApp</a>
                  &nbsp;·&nbsp;
                  <a href="{{instagram_url}}" style="color:#FFFFFF;text-decoration:underline;font-weight:600;">Instagram @replaycon</a>
                  &nbsp;·&nbsp;
                  Reply to this email
                </div>
              </td>
            </tr>

          </table>
        </td>
      </tr>
    </table>
  </body>
</html>
```

- [ ] **Step 2: Sanity-check by opening locally**

Run: `open src/emails/registration.html`
Expected: browser renders the template with literal `{{placeholders}}` visible. Layout shape, borders, hard shadows, colored blocks all correct in Chrome/Safari. (Full visual verification with substituted values happens in Task 7.)

- [ ] **Step 3: Commit**

```bash
git add src/emails/registration.html
git commit -m "$(cat <<'EOF'
email: rewrite registration template to bgc-aligned 1E identity

Single brutalist card on cream bg, 4px ink border, 8px hard shadow.
Adds four new content blocks: What to expect (yellow), Add to calendar
(green, Google + .ics CTAs), Schedule + venue (violet), Share + social
footer (ink, white text). Uses five new template placeholders the
worker now provides (calendar_google_url, calendar_ics_url,
schedule_url, instagram_url, whatsapp_share_url). All CSS inline,
table-based layout, no web fonts — Outlook-safe.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: Manual verification (pre-deploy gate)

**Files:** none

This task is a gate, not code. Do not proceed to Task 8 (deploy) without all six checks passing.

- [ ] **Step 1: Start the worker locally**

Run: `cd worker && npm run dev`
Expected: wrangler dev server boots on `http://localhost:8787`. Leave running.

- [ ] **Step 2: Hit the ICS endpoint and validate**

In a new terminal:
```bash
curl -i http://localhost:8787/api/ics/replay-3.ics
```
Expected:
- Status `200 OK`
- `content-type: text/calendar; charset=utf-8`
- `cache-control: public, max-age=86400`
- Body starts with `BEGIN:VCALENDAR` and ends with `END:VCALENDAR`
- Contains `SUMMARY:REPLAY 3rd edition`

Copy the body and paste into [icalendar.org/validator.html](https://icalendar.org/validator.html). Expected: **zero errors**. (Warnings about non-required fields are OK.)

Then test the 404 path:
```bash
curl -i http://localhost:8787/api/ics/replay-99.ics
```
Expected: `404` (replay-99 doesn't exist in the seed).

- [ ] **Step 3: Render the email with substituted placeholders**

Make a temp scratch copy of the template with values substituted by hand, then open in Chrome:

```bash
mkdir -p /tmp/replay-email-preview
cp src/emails/registration.html /tmp/replay-email-preview/preview.html

# Substitute placeholders with realistic values
python3 <<'EOF'
import pathlib
p = pathlib.Path('/tmp/replay-email-preview/preview.html')
content = p.read_text()
subs = {
    '{{name}}': 'Siddhant',
    '{{edition_name}}': 'REPLAY 3rd edition',
    '{{venue}}': 'TBD',
    '{{start_date}}': '2026-09-12',
    '{{end_date}}': '2026-09-13',
    '{{pass_type}}': 'Campaign',
    '{{days_label}}': 'Saturday + Sunday',
    '{{seats}}': '1',
    '{{amount_paid}}': '0',
    '{{discount_applied}}': '1400',
    '{{guild_tier}}': 'guildmaster',
    '{{calendar_google_url}}': 'https://calendar.google.com/calendar/render?action=TEMPLATE&text=REPLAY%203rd%20edition&dates=20260912T043000Z%2F20260913T133000Z&details=Bangalore%20board-game%20convention&location=TBD',
    '{{calendar_ics_url}}': 'https://api.replaycon.in/api/ics/replay-3.ics',
    '{{schedule_url}}': 'https://replaycon.in/schedule',
    '{{instagram_url}}': 'https://instagram.com/replaycon',
    '{{whatsapp_share_url}}': 'https://wa.me/?text=Going%20to%20REPLAY%203rd%20edition%20...',
}
for k, v in subs.items():
    content = content.replace(k, v)
p.write_text(content)
print('written:', p)
EOF

open /tmp/replay-email-preview/preview.html
```

Expected: every block renders correctly. Visual checklist:
- Cream `#FFF8E7` page background
- White card with 4px ink border + 8px hard shadow offset
- Orange header with pill badges
- Details table with 3px ink frame, 2px row dividers
- Yellow / green / violet blocks each with 3px ink border
- "Google Calendar" and "Download .ics" buttons have hard shadow
- Ink footer band with three inline links separated by `·`

- [ ] **Step 4: Send a test email**

Use [putsmail.com](https://putsmail.com) with the substituted HTML from Step 3. Send to three addresses:
1. `siddhantnarula96@gmail.com` (Gmail web + Gmail iOS app)
2. An Apple iCloud address you control (Apple Mail iOS)
3. An Outlook.com address you control (Outlook web)

Expected per client:
- **Gmail web/iOS:** full fidelity — borders, shadows, all blocks render
- **Apple Mail iOS:** full fidelity; tap `Download .ics` adds event to calendar
- **Outlook web:** colors + borders hold; box-shadow may flatten (acceptable)

If any of these is broken, stop and fix the template — don't proceed to deploy.

- [ ] **Step 5: Round-trip the "Add to calendar" CTAs**

From the Gmail render:
- Click `Google Calendar` → Google opens with title `REPLAY 3rd edition`, dates `Sep 12-13, 2026` (or your local equivalent of 04:30–13:30 UTC).
- Click `Download .ics` → currently 404s because the URL points to the production `api.replaycon.in/api/ics/replay-3.ics` which won't be live until Task 8 deploy. **This is expected at this gate**; verify only that the URL is correctly formed in the rendered email source.

- [ ] **Step 6: Run the full worker suite one last time**

Run: `cd worker && npx vitest run`
Expected: all tests pass (~78 total).

If all six checks pass, proceed to Task 8.

---

## Task 8: Deploy + post-deploy smoke

**Files:** none (deployment + verification)

Deploy order matters. Worker must go live first; otherwise emails sent in the gap have a 404 `.ics` link.

- [ ] **Step 1: Deploy the worker**

Run: `cd worker && npx wrangler deploy`
Expected: deploys successfully. Note the deployed version ID in output.

- [ ] **Step 2: Smoke-test the production ICS endpoint**

```bash
curl -i https://api.replaycon.in/api/ics/replay-3.ics
```
Expected:
- `200 OK`
- `content-type: text/calendar; charset=utf-8`
- Body parses as iCalendar (paste into [icalendar.org/validator.html](https://icalendar.org/validator.html) → zero errors)

```bash
curl -i https://api.replaycon.in/api/ics/replay-99.ics
```
Expected: `404`.

- [ ] **Step 3: Merge the template change to main**

The template commits (Tasks 1-6) should be on a feature branch. Open a PR, get the user's review, merge to `main`. Cloudflare Pages will rebuild the site automatically (the template lives in `src/emails/` but Pages still rebuilds since git changed — that's fine, no harm).

Once merged, GAS picks up the new template on its next `UrlFetchApp.fetch` call (up to 5 min cache TTL).

- [ ] **Step 4: End-to-end test against production**

Trigger a real zero-payment registration:
- Open `https://replaycon.in/register`
- Enter a Guild Path member's phone (use a known guildmaster account, or temporarily seed one)
- Complete the form; submit
- Within ~30s, check the registered email inbox

Expected:
- Subject reads `REPLAY 3rd edition — registration confirmed`
- Body header reads `You're in for REPLAY 3rd edition.`
- All four new blocks render correctly
- `Google Calendar` link opens Google with correct event details
- `Download .ics` link downloads a valid .ics file that opens in Apple Calendar / Outlook

- [ ] **Step 5: Cancel the test registration**

Use the cancel-registration flow (or admin SQL) to remove the test row so it doesn't pollute capacity counts:

```sql
delete from registrations where email = 'siddhantnarula96@gmail.com' and created_at > now() - interval '10 minutes';
```

- [ ] **Step 6: Update CLAUDE.md learnings + handoff**

Append to `CLAUDE.md` under "Session learnings":
```
- 2026-05-24 — Phase 1F shipped: registration email template updated to 1E visual identity (single card, cream bg, 4px ink, hard shadow, yellow/green/violet/ink blocks). Five new template placeholders ({{calendar_google_url}}, {{calendar_ics_url}}, {{schedule_url}}, {{instagram_url}}, {{whatsapp_share_url}}) fed by worker. New worker route `GET /api/ics/:slug.ics` returns iCalendar for any published edition. Edition display name now derived via worker-side `editionOrdinal(slug)` — subject + body render "REPLAY 3rd edition" instead of the previously-broken "REPLAY REPLAY". **Why it matters:** the email is fetched live by GAS from main branch raw.githubusercontent; template changes require merging to main + waiting up to 5min for GAS cache. Worker deploy must precede template merge (otherwise `.ics` links 404).
```

Update `docs/superpowers/HANDOFF.md`:
- Strike Phase 1F from "Phases pending"
- Add row to "Phases shipped" table

Commit and push:
```bash
git add CLAUDE.md docs/superpowers/HANDOFF.md
git commit -m "$(cat <<'EOF'
Phase 1F shipped: log learnings + update handoff

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
git push
```

---

## Done

After Task 8, the next session can pick up any of the remaining pending phases (pre-order checkout, Phase 2 historical import, Phase 3 admin, Playwright E2E) from the updated handoff.
