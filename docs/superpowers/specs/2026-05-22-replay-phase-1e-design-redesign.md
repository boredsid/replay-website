# REPLAY Phase 1E — Visual redesign (bgc-aligned)

**Date:** 2026-05-22
**Status:** Approved (brainstorm complete; implementation plan pending)
**Parent:** `docs/superpowers/specs/2026-05-18-replay-rebuild-design.md`
**Predecessor:** Phase 1D (cutover) — `main` is now production
**Branch:** new feature branch `redesign/phase-1e` off `main`; merges to `main` at end. CF Pages production stays on `main`; preview URL surfaces the redesign during development.

## Goal

Replace Phase 1C's "brutalist primitives but no patterns" port with a full bgc-aligned visual identity — same palette as bgc-website, same layout patterns (dark slab hero, edge-to-edge photo band, alternating colored editorial stripes, dark band CTAs, orange CTA finish), same typography scale. Result: REPLAY reads as a literal sibling site to BGC.

## Non-goals

- Email template visual rework — its own future phase (Phase 1F).
- New photography / professional shoot — descoped entirely. Reuse the 7 existing carousel photos.
- Animations beyond bgc's hover-lift pattern — descoped.
- `/preorder` page redesign — bundled into 1B-extra (when product catalog is ready).
- `/editions/[slug]` archive page — **removed from scope entirely**. Replacement: a "Past editions" footer-linked page in a future final phase.
- Admin SPA styling — Phase 3.
- Worker code, content collections schema, supabase tables — untouched. This is a visual layer change only.

## Decisions captured

| Decision | Choice |
|---|---|
| Palette | **B. Full bgc match** — orange + pink + blue + green + purple + yellow on cream `#FFF8E7` |
| Landing structure | **A. Full bgc-arc port** — 9 stacked sections |
| Scope | **C. Full 3-page redesign** — landing, register, schedule |
| Branch / deploy | **A. Feature branch + preview URL** — `main` stays the prod source of truth |
| Implementation skill | `superpowers/frontend-design` skill (`/frontend-design:frontend-design`) from `frontend-design` plugin |

## Scope

**In:**
- `src/styles/global.css` palette overhaul (token swap + new utility classes)
- 4 new shared components (Astro): `HeroPhotoBand`, `EditorialStripe`, `DarkBand`, `SponsorsBand`
- Landing (`/`) full rebuild with 9-section composition (dark hero → photo band → edition meta band → 3 editorial stripes → Guild Path dark band → sponsors band → orange register CTA finish)
- Register (`/register`) layout overhaul: cream header band + form in centered brutal card with orange top stripe
- Schedule (`/schedule`) layout overhaul: cream header band + timeline-style ScheduleDay
- Photos moved from `public/carousel-photos/` → `src/assets/landing/` (renamed per slot, optimized via Astro `Image`)
- Sub-components retouched for palette consistency: `NotifyMeForm`, `RegisterForm`, `SuccessScreen`, `UpiBottomSheet`, `LiveSpotsBadge`, `ScheduleDay` — drop `pill-teal`/`pill-violet`, add bgc equivalents
- Typography scale via `clamp()` matching bgc (headings up to 5rem on desktop)
- `<Layout>` updates: confirm Google Fonts link still loads correct weights for Space Grotesk (500/700/800)

**Out:**

| Item | Target |
|---|---|
| Email template visual rework | Phase 1F (separate phase per user direction) |
| New photography | descoped |
| `/preorder` page + endpoint + products + email | 1B-extra (when catalog is ready) |
| `/editions/[slug]` archive page | **removed** — replaced by future "Past editions" footer page |
| Past editions footer page | final phase, designed later |
| Admin SPA styling | Phase 3 |
| Worker, schema, collections, RLS changes | unchanged (visual layer only) |
| Animations beyond hover-lift | post-launch / never |
| Playwright E2E | post-launch hardening |

## Palette + tokens

Replace `src/styles/global.css` `@theme` block:

```css
@theme {
  --color-orange: #F47B20;
  --color-orange-dark: #D96A15;
  --color-pink: #FF6B6B;
  --color-blue: #4ECDC4;
  --color-green: #A8E6CF;
  --color-purple: #C3A6FF;
  --color-yellow: #FFD166;
  --color-cream: #FFF8E7;
  --color-cream-dark: #FAFAF5;
  --color-ink: #1A1A1A;
  --color-paper: #FFFFFF;
  --color-error: #DC2626;

  --font-heading: 'Space Grotesk', sans-serif;
  --font-body: 'Inter', sans-serif;
}
```

**Removed:** `--color-teal`, `--color-violet`, `--color-orange-light`. **Cream:** `#FFF8F0` → `#FFF8E7` (bgc value).

**New utility class:**

```css
.section-tag {
  display: inline-block;
  padding: 6px 14px;
  background: #1A1A1A;
  color: #FFFFFF;
  font-family: var(--font-heading);
  font-weight: 700;
  font-size: 0.75rem;
  letter-spacing: 0.15em;
  text-transform: uppercase;
  border-radius: 4px;
  margin-bottom: 16px;
}
```

**Updated:** `.btn-secondary` hover uses `--color-pink` (bgc default), not the teal we picked in 1C.

**Pill variants:** drop `.pill-teal`, `.pill-violet`. Add `.pill-pink`, `.pill-blue`, `.pill-green`, `.pill-purple`.

**Schedule kind colors:**

```ts
const KIND_PILL = {
  workshop:    'pill-blue',
  tournament:  'pill-pink',
  'open-play': 'pill-yellow',
  meal:        'pill-green',
  talk:        'pill-purple',
};
```

## New shared components

### `<HeroPhotoBand>`

Edge-to-edge band of 3 photos. Props: `photos: ImageMetadata[]`. Desktop: 3 equal-width columns, `object-cover`. Mobile: horizontal scroll with `scroll-snap-type: x mandatory`.

### `<EditorialStripe>`

The workhorse for the landing's content sections. Props:

```ts
{
  number: string;         // "01"
  label: string;          // "THE EVENT"
  heading?: string;
  body: string;
  ctaText: string;
  ctaHref: string;
  ctaExternal?: boolean;
  bgColor: string;        // bgc palette hex
  photo: ImageMetadata;
  photoAlt: string;
  photoSide: 'left' | 'right';
}
```

Slot: `heading` slot accepts richer content (e.g. inline counts).

Layout: 2-column grid (`max-w-[1200px]`). Photo column gets a brutal border + shadow. Content column has the number + label + heading (`clamp(2-4rem)`) + body + CTA. Section bg = `bgColor`.

### `<DarkBand>`

Reusable dark slab. Props:

```ts
{
  eyebrow?: string;          // optional "▸ FOR REGULARS"
  eyebrowColor?: string;     // default white; override e.g. --color-yellow
  heading: string;
  body?: string;
  cta?: { text: string; href: string; variant?: 'primary' | 'outline-white'; external?: boolean };
  cta2?: { text: string; href: string; variant?: 'primary' | 'outline-white'; external?: boolean };
}
```

Background `#1A1A1A`, white text, headings scale `clamp(2.4rem, 7vw, 5rem)`.

### `<SponsorsBand>`

Tier-stacked sponsors:
- **Title** sponsor: solo, large card (`.card-brutal-lg`), centered, logo h-32
- **Gold**: 2-3 column grid, large cards, logo h-20
- **Silver**: 4-column grid, medium cards, logo h-16
- **Partner**: 5-6 column grid, small cards, logo h-14

Background: `--color-cream`. Section eyebrow: yellow `.section-tag` reading "SPONSORS".

Hidden if `sponsors.length === 0` (current state — none seeded for replay-3).

## Page compositions

### Landing (`/`)

9 sections in order:
1. `<DarkBand>` — "A weekend of board games." subtitle + 2 CTAs ("Get notified →" / "See past photos")
2. `<HeroPhotoBand>` — 3 photos
3. Cream edition meta band — section-tag + edition info + `<LiveSpotsBadge>`
4. `<EditorialStripe>` 01/THE EVENT (yellow bg, photo left)
5. `<EditorialStripe>` 02/200+ GAMES (blue bg, photo right)
6. `<EditorialStripe>` 03/COMMUNITY (purple bg, photo left)
7. `<DarkBand>` — Guild Path teaser ("▸ FOR REGULARS")
8. `<SponsorsBand>` — hidden if empty
9. Orange CTA finish — community-cta band with photo backdrop at 18% opacity

Photo assignments (rename when moving to `src/assets/landing/`):
- `hero-band-1.jpeg`, `hero-band-2.jpeg`, `hero-band-3.jpeg` — three picks from `1-7.jpeg` for HeroPhotoBand
- `stripe-event.jpeg`, `stripe-games.jpeg`, `stripe-community.jpeg` — three for EditorialStripes
- `closing-cta.jpeg` — final orange CTA backdrop

Specific assignment of original `1-7.jpeg` to each slot is a content decision made during implementation by eyeballing the photos.

### Register (`/register`)

```
[Layout]
  [section: cream header band, py-14 md:py-20]
    [section-tag "Register" → big h1 (clamp 2.4-3.8rem) → subtitle]
  [section: pb-20]
    [max-w-720 card-brutal (border-4, shadow-8)]
      [top-stripe: 12px orange, border-bottom-3]
      [body: <RegisterForm> or <NotifyMeForm> or "no upcoming" state]
[/Layout]
```

Form internals from 1C unchanged.

### Schedule (`/schedule`)

```
[Layout]
  [section: cream header band, py-14 md:py-20]
    [section-tag "Schedule" → big h1 "When + where" → edition info]
  [section: py-12 max-w-920]
    [<ScheduleDay> day1]
    [<ScheduleDay> day2]
[/Layout]
```

`<ScheduleDay>` becomes a timeline:

```
SATURDAY                                Sep 12, 2026
──────────────────────────────────────────────────────
│
●  10:00–11:30   Demo: Wingspan            [pill-blue]
│  Hall A · Beginner-friendly...
│
●  11:45–13:30   Catan Tournament Round 1  [pill-pink]
│  Main Floor · Sign up at the desk.
```

Vertical line on the left (1px solid `--color-ink`/30), bullet dot at each item's start time (colored to match the pill), then 4-column grid: time / blank / details / pill.

Empty state: `.card-brutal-lg` centered card with "Schedule coming soon."

## Component cleanup

All retouched for palette consistency (no behavior change):

- `NotifyMeForm.tsx` — keep `.pill-yellow` for "Notify me" tag. Remove any teal/violet references.
- `RegisterForm.tsx` — guild-tier preview banner: green instead of teal (`bg-[var(--color-green)]/30`). Anti-split warning: pink instead of violet (`border-[var(--color-pink)]`).
- `SuccessScreen.tsx` — `.pill-accent` (orange) stays.
- `UpiBottomSheet.tsx` — already palette-neutral (uses orange + ink only).
- `LiveSpotsBadge.tsx` — `.pill-black` for sold-out stays.

## Implementation approach

Per user instruction, the implementation plan uses the `frontend-design` plugin's `frontend-design` skill (`/frontend-design:frontend-design`) for the design-quality + code-generation loop. That skill is better suited to visual work than raw subagent dispatch.

The implementation plan (separate file) will:
1. Stand up the new tokens + utility classes first (Tasks 1-2)
2. Build the 4 new shared components with frontend-design skill (Task 3)
3. Rebuild the 3 pages, composing components (Tasks 4-6)
4. Move + rename photos (Task 7)
5. Sweep sub-components for palette consistency (Task 8)
6. Smoke + merge (Tasks 9-10)

## Testing

No new tests. Existing 24 site + 66 worker tests stay green throughout (visual layer only; semantic markers preserved).

## Deploy

- Push commits to `redesign/phase-1e`. Cloudflare Pages auto-builds a preview URL per push (typical pattern: `<short-sha>.replay-website.pages.dev`).
- After review, open PR `redesign/phase-1e` → `main`, merge.
- CF Pages auto-deploys `main` → live apex.
- No DNS / GAS / worker changes.

## Definition of Done

- [ ] `npm run build` succeeds.
- [ ] `npm test` 24/24 green.
- [ ] `cd worker && npm test` 66/66 green.
- [ ] Palette tokens match bgc.
- [ ] 4 new shared components exist + render correctly.
- [ ] 7 photos moved to `src/assets/landing/` and referenced via Astro `Image` component.
- [ ] Landing has 9 sections per spec.
- [ ] Register page renders cream header + orange-stripe brutal card.
- [ ] Schedule page renders cream header + timeline.
- [ ] Sub-components palette-consistent (no orphan teal/violet).
- [ ] PR `redesign/phase-1e` → `main` merged.
- [ ] Live smoke on `https://replaycon.in/` shows new identity.
- [ ] CLAUDE.md updated.

## Open questions for implementation

- Whether the orange register-CTA finish band overlaps semantically with the dark Guild Path band — they're both end-of-page CTA chunks. The bgc pattern uses dark for Guild then orange for community CTA, so we'll mirror it. If during build it feels redundant, drop the orange finish and let the sponsors band close the page.
- Photo assignments are decided during implementation by eyeballing the 7 photos — recommend the implementer (frontend-design skill) view them in a quick HTML grid first, assign, then proceed.
- `<DarkBand>`'s `eyebrow` with the `▸` glyph: confirm it renders cross-platform. Fallback to `>` or an inline SVG arrow if it's iffy on Android browsers.
