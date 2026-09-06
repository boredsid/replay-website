# REPLAY Phase 1B — Site pages (landing + register + schedule)

**Date:** 2026-05-21
**Status:** Approved (brainstorm complete; implementation plan pending)
**Parent:** `docs/superpowers/specs/2026-05-18-replay-rebuild-design.md`
**Predecessor:** `docs/superpowers/specs/2026-05-21-replay-phase-1a-worker-design.md`
**Branch:** `rebuild/phase-0`

## Goal

Ship the three pages needed to replace the legacy site at cutover (Phase 1D): landing, register, schedule. Form is single-page with live discount preview and live spot count. Visual design is intentionally minimal — polish lands in Phase 1C.

## Non-goals

- Pre-order page or endpoint (1B-extra when product catalog is ready)
- Archive page for past editions (alongside Phase 2 historical import)
- Design system port from bgc (1C)
- DNS cutover (1D)
- Admin UI for editions/sponsors/schedule (Phase 3)

## Scope

**In:**
- 3 Astro pages: `/` (landing), `/register`, `/schedule`
- React islands: `<RegisterForm>`, `<LiveSpotsBadge>`
- Astro Content Collections: `landing/hero.mdx`, `landing/about.mdx`
- `src/lib/data.ts` — build-time Supabase reads (anon client, RLS-respecting)
- `src/lib/supabase.ts` — anon Supabase client (browser-safe; Phase 0 placeholder is empty)
- `src/lib/worker.ts` — typed fetch wrappers for the 5 worker endpoints
- Per-page `<title>`, `<meta description>`, OG tags via shared `Layout.astro`
- Sitemap entries for `/`, `/register`, `/schedule`
- `editions.is_published = true` flag flipped for replay-3 so anon Supabase reads can return it
- Pre-launch lead capture on `/register` when `registration_status !== 'open'`
- Live "X spots left" badge on landing CTA + on `/register` form
- "I've paid" UPI flow keeps registration `payment_status='pending'`; no confirmation email until admin confirms (Phase 3)
- Component tests for `<RegisterForm>` + `<LiveSpotsBadge>` + `src/lib/data.ts`

**Out (deferred):**

| Item | Target |
|---|---|
| `/preorder` page + `preorder-checkout` endpoint + products seed + pre-order email template | 1B-extra (when product catalog is ready) |
| `/editions/[slug]` archive page | Phase 2 (alongside historical import) |
| REPLAY palette + Tailwind tokens + design system port from bgc | 1C |
| Custom typography (Space Grotesk + Inter) + hero photo treatment | 1C |
| Footer with social links | 1C |
| Playwright E2E coverage | 1C/1D |
| Apex DNS cutover from GitHub Pages → CF Pages | 1D |
| Merge bgc PR #15 | 1D |
| PR `rebuild/phase-0` → `main` in replay repo | 1D |
| `editions.registration_status='open'` flip in prod | 1D post-cutover |

## Architecture

### Routes + data flow

```
Astro pages (SSG)        Data source                                  When
─────────────────────────────────────────────────────────────────────────────
/ (index.astro)        → editions + sponsors via anon Supabase       build-time
                       → src/content/landing/hero + about             build-time, MDX
                       → <LiveSpotsBadge> React island                runtime, worker /api/edition-spots
/register              → editions via anon Supabase                   build-time
                       → <RegisterForm> React island                  runtime, worker (lookup-phone,
                                                                       edition-spots, register, lead)
/schedule              → editions + schedule_items via anon Supabase  build-time
```

### Rebuild trigger

Admin save (Phase 3) → fires `CLOUDFLARE_PAGES_DEPLOY_HOOK` from worker → Pages rebuild → static HTML refreshes (~30-60s). React islands always read live data from the worker, so reg/spot states stay current between rebuilds.

### Caching

Astro SSG output is CDN-cached at Cloudflare edge. React island fetches go through `api.replaycon.in` — no explicit cache headers in 1B; volume is too low (250 seats) to need it. Revisit if needed.

### Anon-key surface

`src/lib/supabase.ts` exports a browser-safe anon client used by Astro frontmatter at build time. RLS denies anon reads on `users`, `registrations`, `leads`, `orders`, `admin_audit_log` — so even leaked anon key exposes no PII. Migration 001's RLS gates `editions`/`sponsors`/`schedule_items` reads on `is_published`, so an unpublished edition returns nothing.

### File structure

```
src/
├── pages/
│   ├── index.astro                       (landing)
│   ├── register.astro                    (registration)
│   └── schedule.astro                    (schedule)
├── layouts/
│   └── Layout.astro                      (HTML shell, title/meta/OG, nav, footer)
├── components/
│   ├── HeroSection.astro                 (consumes landing/hero.mdx)
│   ├── AboutSection.astro                (consumes landing/about.mdx)
│   ├── SponsorsSection.astro             (renders sponsors[])
│   ├── RegisterCTA.astro                 (CTA wrapper accepting <LiveSpotsBadge> slot)
│   ├── ScheduleDay.astro                 (renders one day's items[])
│   ├── LiveSpotsBadge.tsx                (React island — fetches /api/edition-spots)
│   ├── RegisterForm.tsx                  (React island — full registration flow)
│   └── UpiBottomSheet.tsx                (React, used by RegisterForm)
├── content/
│   ├── config.ts                         (Astro Content Collections schema)
│   └── landing/
│       ├── hero.mdx                      (hero copy, frontmatter: { eyebrow, title, subtitle })
│       └── about.mdx                     (about body)
├── lib/
│   ├── supabase.ts                       (anon client factory)
│   ├── worker.ts                         (typed fetch: lookupPhone, editionSpots, register, lead)
│   ├── data.ts                           (build-time Supabase reads: getCurrentEdition,
│   │                                       getSponsors, getScheduleItems)
│   ├── data.test.ts
│   └── types.ts                          (EditionRow, SponsorRow, ScheduleItemRow,
│                                          ApiLookupPhoneResponse, ApiRegisterResponse, etc.)
└── emails/
    └── registration.html                 (Phase 1A)
```

### `<RegisterForm>` state machine

```
on mount:
  fetch /api/edition-spots/:editionId
  → set spotsByDay; disable any day radio whose day is sold out

on phone field debounce (300ms after last keystroke; only if 10 digits sanitized):
  fetch /api/lookup-phone {phone, edition_id}
  → if user.found: prefill name/email into the (still-editable) fields, render a "Welcome back, {name}" hint above the form
  → if guild.active && !discount_blocked: show discount preview badge
  → if discount_blocked: show "You already registered for {edition_name}; Guild discount only applies to your first pass"

on pass_type + days change:
  compute price preview client-side from edition.pricing (pre-fetched at page build, passed in as prop)
  → "Total: ₹{base}   →   ₹{final} after Guild Path discount"

on submit:
  POST /api/register
  → 200 + final_amount=0 + payment_required=false: show <SuccessScreen> (confirmation email already sent server-side)
  → 200 + payment_required=true: open <UpiBottomSheet>
  → 409 sold_out: refresh edition-spots, show "Just sold out — try the other day" inline error
  → 409 registration_closed: shouldn't happen (page-level guard); show generic error
  → 400: surface field-level validation error inline

UPI bottom sheet:
  show UPI ID + QR code (via api.qrserver.com), instructions
  on "I've paid" click: navigate to <SuccessScreen> with "We'll email you once we confirm your payment."
  payment_status stays 'pending' until admin confirms (Phase 3). No email sent on pending.

on field blur (debounced 1s; fire-and-forget):
  POST /api/lead {phone, edition_id, step_reached}
  step_reached mapping:
    - phone field blur (once phone is 10 valid digits): 'phone_entered'
    - name or email field blur (after phone): 'name_entered'
    - pass_type or days change: 'details_entered'
  Worker rate-limits (2s per phone+edition); client doesn't need to track that.
```

### Registration-closed state on `/register`

When `editions.is_current && (registration_status != 'open' OR not is_published)`:

- Render `<NotifyMeForm>` instead of `<RegisterForm>`.
- Copy varies by status:
  - `upcoming` → "Registration opens soon for {edition_name}. Drop your number and we'll email when it opens."
  - `closed` → "Registration closed for {edition_name}."
  - `sold_out` → "REPLAY 3 is sold out. Want to hear about the next one? Drop your number."
- Single-field form (phone), submits to `/api/lead` with `step_reached='phone_entered'`. No registration.

When no current edition exists (all `is_current=false` or no row at all):
- Show "No upcoming REPLAY right now. Follow on social for announcements." — pure static, no form.

### Worker fetch wrappers (`src/lib/worker.ts`)

```ts
const BASE = import.meta.env.PUBLIC_WORKER_URL;

export async function lookupPhone(phone: string, editionId: string): Promise<ApiLookupPhoneResponse>;
export async function getEditionSpots(editionId: string): Promise<ApiEditionSpotsResponse>;
export async function registerForEdition(input: RegisterInput): Promise<ApiRegisterResponse>;
export async function cancelRegistration(registrationId: string, phone: string): Promise<{ ok: true }>;
export async function captureLead(phone: string, editionId: string, stepReached: StepReached, name?: string): Promise<{ ok: true }>;
```

Each wrapper throws on non-2xx, returning typed response on success. Components handle thrown errors with a generic "Something went wrong, please retry" toast and surfaced field errors when the body contains `{ error, field? }`.

### Astro Content Collections

`src/content/config.ts`:

```ts
import { defineCollection, z } from 'astro:content';

const landing = defineCollection({
  type: 'content',
  schema: z.object({
    eyebrow: z.string().optional(),
    title: z.string().optional(),
    subtitle: z.string().optional(),
  }),
});

export const collections = { landing };
```

`hero.mdx` has frontmatter (eyebrow/title/subtitle) + body for any inline content. `about.mdx` is pure body. `HeroSection.astro` and `AboutSection.astro` import via `getEntry('landing', 'hero')`.

Editing copy = git commit (admin doesn't manage copy in Phase 3 either; staying in MDX is intentional — copy is the kind of thing where PRs add review).

## Testing

- **Worker (Phase 1A):** still 66/66 green (regression).
- **`src/lib/data.test.ts`:** mocks supabase chain, verifies `getCurrentEdition` filters `is_current=true AND is_published=true`, returns null when no row matches; `getSponsors` returns ordered by `display_order`; `getScheduleItems` returns ordered by `(day, start_time)`.
- **`src/components/RegisterForm.test.tsx`:** Vitest + `@testing-library/react`. Cover:
  - Mount fetches edition-spots; sold-out day disables radio.
  - Phone debounce triggers lookup-phone; guildmaster preview renders.
  - `discount_blocked=true` shows the anti-split message.
  - Submit happy path → success screen on amount=0; UPI sheet opens on amount>0.
  - Submit 409 sold_out: error rendered + spots refetched.
  - Lead fire on blur (mock fetch invoked with correct payload).
- **`src/components/LiveSpotsBadge.test.tsx`:** loading state, sold-out state, partial state.
- **Astro pages:** not unit-tested. Verified manually on `replay-website.pages.dev`.

## Deploy + smoke test

After all code merged onto `rebuild/phase-0` + pushed:

1. Cloudflare Pages auto-deploys to `replay-website.pages.dev`.
2. Flip `editions.is_published = true` for replay-3 (via Supabase Studio):
   ```sql
   update editions set is_published = true where slug = 'replay-3';
   ```
3. Smoke on `*.pages.dev`:
   - Landing renders REPLAY 3 hero + about + (empty) sponsors + register CTA with `<LiveSpotsBadge>` showing 250/250.
   - `/schedule` shows "Schedule coming soon."
   - `/register` (status=upcoming) shows the notify-me form. Submit → row in `leads`.
   - Flip `registration_status='open'`, refresh `/register`. Form renders. Run through happy path (oneshot ₹800, no guild) → UPI sheet appears → click "I've paid" → success screen.
   - Verify `registrations` row with `payment_status='pending'`.
   - Cancel via /api/cancel-registration (cleanup).
   - Revert `registration_status='upcoming'`.

## Definition of Done

- [ ] `npm run build` at repo root succeeds; sitemap includes `/`, `/register`, `/schedule`.
- [ ] `npm test` in `worker/` still green (1A regression check).
- [ ] New tests (`data.test.ts`, `RegisterForm.test.tsx`, `LiveSpotsBadge.test.tsx`) all pass.
- [ ] `editions.is_published` flipped to `true` for replay-3 in production Supabase.
- [ ] Deployed to `replay-website.pages.dev` (auto via push).
- [ ] Manual smoke walkthrough above passes end-to-end.
- [ ] All commits pushed to `origin/rebuild/phase-0`.

## Open questions for implementation

- React + Astro + Tailwind 4 — needs `astro-tailwind-vite-plugin` style approach (already wired in Phase 0). React island via `client:load` for forms, `client:visible` for the spots badge (saves below-fold hydration cost).
- Page-level guard for `is_published`: if a page tries to render but the edition isn't published, render a 404-equivalent ("No upcoming edition.") instead of build-failing. Decision: in `data.ts` return null and let pages render a fallback. Build never fails on missing data.
- Sitemap configuration: `@astrojs/sitemap` is already in `astro.config.mjs` (Phase 0). It auto-includes Astro pages; no extra config needed for 3 static routes.
