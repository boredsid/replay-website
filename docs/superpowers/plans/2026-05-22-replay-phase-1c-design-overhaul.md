# REPLAY Phase 1C — Design Overhaul Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restyle the 3 site pages + email template with the neo-brutalist design system shared with `bgc-website` (REPLAY-distinct palette of orange + teal + yellow + violet on cream). Visual is locked at end of 1C so Phase 1D cutover can ship to apex without surprises.

**Architecture:** Single source of truth is `src/styles/global.css` — Tailwind 4 `@theme` tokens + CSS utility classes (`.btn`, `.card-brutal`, `.pill`, `.input-brutal`) ported from bgc with the replay palette swap. Astro components and React islands consume the classes via `class=...`. Google Fonts loaded via `<link>` in Layout. No new tests; existing 24 site + 66 worker tests should remain green.

**Tech Stack:** Tailwind 4 (CSS-config via `@theme`), Astro 6 components, React 19 islands, Google Fonts (Space Grotesk + Inter).

**Branch:** `rebuild/phase-0` (continues from Phase 1B).

**Working directory:** `/Users/siddhantnarula/Projects/replay-website`.

---

## File Structure

```
Modified files:
src/styles/global.css                       (full rewrite — tokens + utilities)
src/layouts/Layout.astro                    (header + footer restyle, Google Fonts link)
src/components/HeroSection.astro            (split layout + photo)
src/components/AboutSection.astro           (token swap)
src/components/SponsorsSection.astro        (card-brutal containers + tier label)
src/components/RegisterCTA.astro            (.btn-primary, brutal hover)
src/components/ScheduleDay.astro            (card-brutal rows + kind pills)
src/pages/schedule.astro                    (heading band + day labels via dayLabel helper)
src/components/RegisterForm.tsx             (form fields, pass buttons, day pills, callouts)
src/components/NotifyMeForm.tsx             (brutal input + button)
src/components/UpiBottomSheet.tsx           (brutal border + shadow)
src/components/SuccessScreen.tsx            (card-brutal centered)
src/components/LiveSpotsBadge.tsx           (.pill output)
src/emails/registration.html                (system fonts + hard shadow + pills)
src/content.config.ts                       (add `photo` to schema)
src/content/landing/hero.mdx                (add photo frontmatter)

New files:
none

Asset:
public/instagram.svg                        (small inline SVG for footer)
```

**Boundary rule:** `global.css` is the only place that knows component class definitions. Components reference classes by name; never inline-duplicate the brutalist primitives.

---

## Task 1: Design tokens + utility classes (global.css)

**Files:**
- Modify (full rewrite): `src/styles/global.css`

- [ ] **Step 1: Replace `src/styles/global.css` contents**

```css
@import "tailwindcss";

@theme {
  /* REPLAY palette — orange anchor + teal/yellow/violet accents */
  --color-orange: #F47B20;
  --color-orange-light: #FF8F3E;
  --color-orange-dark: #D96A15;
  --color-teal: #4A9B8E;
  --color-yellow: #FFD166;
  --color-violet: #7C3AED;
  --color-cream: #FFF8F0;
  --color-cream-dark: #F0E6D8;
  --color-ink: #1A1A1A;
  --color-paper: #FFFFFF;
  --color-error: #DC2626;

  /* Typography */
  --font-heading: 'Space Grotesk', sans-serif;
  --font-body: 'Inter', sans-serif;
}

:root {
  --border: 3px solid #1A1A1A;
  --border-thick: 4px solid #1A1A1A;
  --shadow-sm: 4px 4px 0 #1A1A1A;
  --shadow-md: 6px 6px 0 #1A1A1A;
  --shadow-lg: 8px 8px 0 #1A1A1A;
  --shadow-xl: 12px 12px 0 #1A1A1A;
  --radius-sm: 8px;
  --radius-md: 12px;
  --radius-lg: 16px;
  --radius-xl: 20px;
}

html { scroll-behavior: smooth; scroll-padding-top: 80px; }
body {
  background: var(--color-cream);
  color: var(--color-ink);
  font-family: var(--font-body);
  line-height: 1.6;
  overflow-x: hidden;
}
h1, h2, h3, h4 {
  font-family: var(--font-heading);
  font-weight: 700;
  line-height: 1.1;
  letter-spacing: -0.02em;
}

/* ---------- Buttons ---------- */
.btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  padding: 14px 28px;
  font-family: var(--font-heading);
  font-size: 1rem;
  font-weight: 600;
  border: var(--border-thick);
  border-radius: var(--radius-md);
  cursor: pointer;
  white-space: nowrap;
  text-decoration: none;
  transition: transform 0.15s, box-shadow 0.15s, background 0.15s;
}
.btn:hover { box-shadow: var(--shadow-md); transform: translate(-2px, -2px); }
.btn:active { box-shadow: none; transform: translate(2px, 2px); }
.btn:disabled { opacity: 0.5; cursor: not-allowed; transform: none; box-shadow: var(--shadow-sm); }
.btn:disabled:hover { transform: none; box-shadow: var(--shadow-sm); }

.btn-primary { background: #F47B20; color: #FFFFFF; box-shadow: var(--shadow-sm); }
.btn-primary:hover { background: #FF8F3E; box-shadow: var(--shadow-lg); }

.btn-secondary { background: #FFFFFF; color: #1A1A1A; box-shadow: var(--shadow-sm); }
.btn-secondary:hover { background: #4A9B8E; color: #FFFFFF; box-shadow: var(--shadow-lg); }

.btn-black { background: #1A1A1A; color: #FFFFFF; box-shadow: var(--shadow-sm); }
.btn-black:hover { box-shadow: var(--shadow-md); }

.btn-nav { padding: 10px 20px; font-size: 0.9rem; background: #F47B20; color: #FFFFFF; box-shadow: 3px 3px 0 #1A1A1A; }
.btn-sm { padding: 8px 18px; font-size: 0.85rem; }
.btn-block { width: 100%; }

/* ---------- Cards ---------- */
.card-brutal {
  border: var(--border-thick);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-md);
  background: #FFFFFF;
  transition: transform 0.25s, box-shadow 0.25s;
}
.card-brutal:hover { box-shadow: var(--shadow-lg); transform: translate(-3px, -3px); }

.card-brutal-lg { box-shadow: var(--shadow-lg); }
.card-brutal-lg:hover { box-shadow: var(--shadow-xl); transform: translate(-4px, -4px); }

.card-flat {
  border: var(--border);
  border-radius: var(--radius-md);
  background: #FFFFFF;
}

/* ---------- Pills ---------- */
.pill {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 12px;
  font-family: var(--font-heading);
  font-size: 0.8rem;
  font-weight: 700;
  border: 2px solid #1A1A1A;
  border-radius: 999px;
  background: #FFFFFF;
  color: #1A1A1A;
}
.pill-accent { background: #F47B20; color: #FFFFFF; }
.pill-black  { background: #1A1A1A; color: #FFFFFF; }
.pill-yellow { background: #FFD166; color: #1A1A1A; }
.pill-teal   { background: #4A9B8E; color: #FFFFFF; }
.pill-violet { background: #7C3AED; color: #FFFFFF; }
.pill-cream  { background: #F0E6D8; color: #1A1A1A; }

/* ---------- Inputs ---------- */
.input-brutal {
  width: 100%;
  padding: 12px 14px;
  border: var(--border);
  border-radius: var(--radius-md);
  background: #FFFFFF;
  font-family: var(--font-body);
  font-size: 1rem;
  color: #1A1A1A;
  box-shadow: var(--shadow-sm);
  transition: box-shadow 0.15s;
}
.input-brutal:focus { outline: none; box-shadow: var(--shadow-md); }
.input-brutal::placeholder { color: #1A1A1A; opacity: 0.45; }
.input-brutal:disabled { opacity: 0.5; cursor: not-allowed; }

/* ---------- Labels ---------- */
.label-brutal {
  display: block;
  font-family: var(--font-heading);
  font-size: 0.85rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  margin-bottom: 6px;
}

/* ---------- Section + container ---------- */
.section { padding: 64px 24px; }
.container-x { max-width: 1024px; margin: 0 auto; }

/* ---------- REPLAY wordmark ---------- */
.replay-wordmark {
  font-family: var(--font-heading);
  font-weight: 800;
  font-size: 1.4rem;
  letter-spacing: -0.02em;
  color: var(--color-orange);
  text-decoration: none;
}
```

- [ ] **Step 2: Verify build**

Run: `npm run build 2>&1 | tail -5`
Expected: build succeeds (Astro picks up new global.css; Tailwind 4 reads `@theme` tokens).

- [ ] **Step 3: Run tests**

Run: `npm test`
Expected: 24/24 site tests still pass (CSS changes don't affect React behavior tests).

- [ ] **Step 4: Commit**

```bash
git add src/styles/global.css
git commit -m "Phase 1C: REPLAY design tokens + brutalist utility classes

Tailwind 4 @theme block with REPLAY palette (orange + teal + yellow +
violet on cream). Ports bgc's .btn / .card-brutal / .pill / .input-brutal
classes with replay-specific color swaps (.btn-secondary hover = teal).

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 2: Layout shell — fonts + header + footer

**Files:**
- Modify: `src/layouts/Layout.astro`
- Create: `public/instagram.svg`

- [ ] **Step 1: Create `public/instagram.svg`**

```xml
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
  <rect x="2" y="2" width="20" height="20" rx="5" ry="5"></rect>
  <path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z"></path>
  <line x1="17.5" y1="6.5" x2="17.51" y2="6.5"></line>
</svg>
```

- [ ] **Step 2: Replace `src/layouts/Layout.astro` contents**

```astro
---
import '../styles/global.css';
export interface Props {
  title: string;
  description?: string;
  ogImage?: string;
}
const { title, description = "Bangalore's board game convention — meet, play, repeat.", ogImage = '/link-preview.png' } = Astro.props;
const canonical = new URL(Astro.url.pathname, Astro.site ?? 'https://replaycon.in').toString();
---
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <title>{title}</title>
    <meta name="description" content={description} />
    <link rel="canonical" href={canonical} />
    <meta property="og:type" content="website" />
    <meta property="og:title" content={title} />
    <meta property="og:description" content={description} />
    <meta property="og:url" content={canonical} />
    <meta property="og:image" content={new URL(ogImage, Astro.site ?? 'https://replaycon.in').toString()} />
    <meta name="twitter:card" content="summary_large_image" />
    <link rel="icon" type="image/png" href="/replay-logo.png" />
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Space+Grotesk:wght@500;700;800&display=swap" rel="stylesheet" />
  </head>
  <body>
    <header class="sticky top-0 z-40 bg-[var(--color-cream)] border-b-4 border-[var(--color-ink)]">
      <div class="container-x px-6 py-4 flex items-center justify-between">
        <a href="/" class="replay-wordmark">REPLAY</a>
        <nav class="flex gap-3">
          <a href="/schedule" class="btn btn-nav">Schedule</a>
          <a href="/register" class="btn btn-nav">Register</a>
        </nav>
      </div>
    </header>

    <main class="min-h-[60vh]">
      <slot />
    </main>

    <footer class="border-t-4 border-[var(--color-ink)] bg-[var(--color-paper)]">
      <div class="container-x px-6 py-8 flex flex-col md:flex-row md:items-center md:justify-between gap-4 text-sm">
        <a href="mailto:hello@boardgamecompany.in" class="hover:underline font-medium">hello@boardgamecompany.in</a>
        <a href="https://www.instagram.com/replay.convention" target="_blank" rel="noopener" aria-label="REPLAY on Instagram" class="inline-flex items-center gap-2 hover:text-[var(--color-orange)]">
          <img src="/instagram.svg" alt="" width="20" height="20" />
          <span>@replay.convention</span>
        </a>
        <p class="text-gray-600">&copy; REPLAY · Bangalore</p>
      </div>
    </footer>
  </body>
</html>
```

- [ ] **Step 3: Build + test**

Run: `npm run build 2>&1 | tail -5 && npm test 2>&1 | tail -3`
Expected: build succeeds, tests 24/24 pass.

- [ ] **Step 4: Commit**

```bash
git add src/layouts/Layout.astro public/instagram.svg
git commit -m "Phase 1C: Layout shell with Google Fonts + sticky header + 3-col footer

Sticky header (REPLAY wordmark in orange + .btn-nav buttons for
Schedule/Register). Footer: mailto-left, Instagram-center, copyright-right.
Loads Space Grotesk + Inter via Google Fonts with preconnect.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 3: Hero — split layout + photo

**Files:**
- Modify: `src/content.config.ts` (add photo to schema)
- Modify: `src/content/landing/hero.mdx` (add photo frontmatter)
- Modify: `src/components/HeroSection.astro` (split grid)

- [ ] **Step 1: Update `src/content.config.ts`**

```ts
import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

const landing = defineCollection({
  loader: glob({ pattern: '**/*.mdx', base: './src/content/landing' }),
  schema: z.object({
    eyebrow: z.string().optional(),
    title: z.string().optional(),
    subtitle: z.string().optional(),
    photo: z.string().optional(),
  }),
});

export const collections = { landing };
```

- [ ] **Step 2: Update `src/content/landing/hero.mdx`**

Replace the frontmatter block to include `photo`:

```mdx
---
eyebrow: "Bangalore"
title: "A weekend of board games."
subtitle: "Two days. Hundreds of players. One library of 200+ games. Beginners welcome."
photo: "/carousel-photos/3.jpeg"
---

REPLAY is the convention for people who love sitting down with a stranger and an unfamiliar rulebook. Bring your favourite games or play ones you've never seen. Tournaments, demos, open play, and one big room full of dice.
```

- [ ] **Step 3: Rewrite `src/components/HeroSection.astro`**

```astro
---
import { getCollection, render } from 'astro:content';
import type { EditionRow } from '../lib/types';
export interface Props { edition: EditionRow | null }
const { edition } = Astro.props;
const entries = await getCollection('landing');
const hero = entries.find((e) => e.id === 'hero' || e.id.endsWith('hero'));
const data = (hero?.data ?? {}) as { eyebrow?: string; title?: string; subtitle?: string; photo?: string };
const Body = hero ? (await render(hero)).Content : null;
const ctaLabel = edition?.registration_status === 'open' ? 'Register now' :
                 edition?.registration_status === 'sold_out' ? 'Sold out' :
                 edition?.registration_status === 'closed' ? 'Registration closed' :
                 'Get notified';
---
<section class="section">
  <div class="container-x grid grid-cols-1 md:grid-cols-[1.2fr_1fr] gap-12 items-center">
    <div>
      {data.eyebrow && <div class="text-sm uppercase tracking-[0.15em] text-[var(--color-orange)] font-bold mb-3">{data.eyebrow}</div>}
      {data.title && <h1 class="text-5xl md:text-6xl font-bold mb-4">{data.title}</h1>}
      {data.subtitle && <p class="text-lg text-gray-700 mb-4">{data.subtitle}</p>}
      {edition && (
        <p class="text-sm text-gray-600 mb-8">
          <strong>{edition.name}</strong> · {edition.start_date} – {edition.end_date} · {edition.venue}
        </p>
      )}
      {edition && (
        <a href="/register" class="btn btn-primary">{ctaLabel}</a>
      )}
      {Body && <div class="mt-8 prose max-w-none"><Body /></div>}
    </div>
    {data.photo && (
      <div class="card-brutal overflow-hidden order-first md:order-none">
        <img src={data.photo} alt="REPLAY past edition" class="block w-full aspect-[4/5] object-cover" />
      </div>
    )}
  </div>
</section>
```

- [ ] **Step 4: Build + test**

Run: `npm run build 2>&1 | tail -5 && npm test 2>&1 | tail -3`
Expected: build succeeds (no test impact — hero is Astro-only).

Verify: `grep -o "carousel-photos/3.jpeg\|order-first" dist/index.html`
Expected: both strings found.

- [ ] **Step 5: Commit**

```bash
git add src/content.config.ts src/content/landing/hero.mdx src/components/HeroSection.astro
git commit -m "Phase 1C: Hero split layout with photo

2-column grid (text left, photo right) on desktop; photo stacks above
text on mobile (order-first). Photo path lives in hero.mdx frontmatter
so it can be swapped without touching component code. Initial photo:
/carousel-photos/3.jpeg.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 4: About + Sponsors + RegisterCTA restyle

**Files:**
- Modify: `src/components/AboutSection.astro`
- Modify: `src/components/SponsorsSection.astro`
- Modify: `src/components/RegisterCTA.astro`

- [ ] **Step 1: Rewrite `src/components/AboutSection.astro`**

```astro
---
import { getCollection, render } from 'astro:content';
const entries = await getCollection('landing');
const about = entries.find((e) => e.id === 'about' || e.id.endsWith('about'));
const Body = about ? (await render(about)).Content : null;
const title = (about?.data as { title?: string } | undefined)?.title ?? 'About REPLAY';
---
<section class="section bg-[var(--color-paper)] border-t-4 border-b-4 border-[var(--color-ink)]">
  <div class="container-x">
    <span class="pill pill-cream mb-4">About</span>
    <h2 class="text-4xl md:text-5xl mb-6">{title}</h2>
    {Body && <div class="prose max-w-none text-lg"><Body /></div>}
  </div>
</section>
```

- [ ] **Step 2: Rewrite `src/components/SponsorsSection.astro`**

```astro
---
import type { SponsorRow } from '../lib/types';
export interface Props { sponsors: SponsorRow[] }
const { sponsors } = Astro.props;
if (sponsors.length === 0) return null;
const tiers: Array<{ key: SponsorRow['tier']; label: string; pillClass: string }> = [
  { key: 'title',   label: 'Title sponsor', pillClass: 'pill-accent' },
  { key: 'gold',    label: 'Gold sponsors', pillClass: 'pill-yellow' },
  { key: 'silver',  label: 'Silver sponsors', pillClass: 'pill-cream' },
  { key: 'partner', label: 'Partners',      pillClass: 'pill' },
];
const byTier = Object.fromEntries(tiers.map((t) => [t.key, sponsors.filter((s) => s.tier === t.key)]));
---
<section class="section">
  <div class="container-x">
    <span class="pill pill-cream mb-4">Backers</span>
    <h2 class="text-4xl md:text-5xl mb-8">Sponsors</h2>
    <div class="flex flex-col gap-10">
      {tiers.map((t) => byTier[t.key].length > 0 && (
        <div>
          <div class="flex items-center gap-3 mb-4">
            <span class={`pill ${t.pillClass}`}>{t.label}</span>
          </div>
          <div class="grid grid-cols-2 md:grid-cols-4 gap-6">
            {byTier[t.key].map((s) => (
              <a href={s.website_url ?? '#'} target={s.website_url ? '_blank' : undefined} rel="noopener"
                 class="card-brutal flex items-center justify-center p-6 h-32">
                <img src={s.logo_url} alt={s.name} class="max-h-16 object-contain" />
              </a>
            ))}
          </div>
        </div>
      ))}
    </div>
  </div>
</section>
```

- [ ] **Step 3: Rewrite `src/components/RegisterCTA.astro`**

```astro
---
import type { EditionRow } from '../lib/types';
export interface Props { edition: EditionRow | null }
const { edition } = Astro.props;
const ctaLabel = edition?.registration_status === 'open' ? 'Register now' :
                 edition?.registration_status === 'sold_out' ? 'Sold out' :
                 edition?.registration_status === 'closed' ? 'Registration closed' :
                 'Get notified';
const ctaClass = edition?.registration_status === 'sold_out' ? 'btn btn-black' : 'btn btn-primary';
---
<section class="section bg-[var(--color-paper)] border-t-4 border-[var(--color-ink)]">
  <div class="container-x text-center">
    {edition ? (
      <>
        <span class="pill pill-yellow mb-4">{edition.name} · {edition.start_date}</span>
        <h2 class="text-4xl md:text-5xl mb-6">Ready to play?</h2>
        <a href="/register" class={ctaClass}>{ctaLabel}</a>
        <div class="mt-6">
          <slot />
        </div>
      </>
    ) : (
      <p class="text-gray-600 text-lg">No upcoming REPLAY right now. Follow on social for announcements.</p>
    )}
  </div>
</section>
```

- [ ] **Step 4: Build + test**

Run: `npm run build 2>&1 | tail -5 && npm test 2>&1 | tail -3`
Expected: build succeeds; tests 24/24 pass.

- [ ] **Step 5: Commit**

```bash
git add src/components/AboutSection.astro src/components/SponsorsSection.astro src/components/RegisterCTA.astro
git commit -m "Phase 1C: About + Sponsors + RegisterCTA restyle

About gets paper bg + thick top/bottom borders + pill label.
Sponsors render in card-brutal grid with tier-colored pills.
RegisterCTA uses .btn-primary (or .btn-black when sold out).

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 5: LiveSpotsBadge restyle

**Files:**
- Modify: `src/components/LiveSpotsBadge.tsx`

- [ ] **Step 1: Rewrite the return block**

Open `src/components/LiveSpotsBadge.tsx` and replace ONLY the JSX render block (the bottom half of the file). Keep the existing useState/useEffect logic and props interface intact. Final state:

```tsx
import { useEffect, useState } from 'react';
import { getEditionSpots } from '../lib/worker';
import type { ApiEditionSpotsResponse } from '../lib/types';

export interface LiveSpotsBadgeProps {
  editionId: string;
}

export function LiveSpotsBadge({ editionId }: LiveSpotsBadgeProps) {
  const [spots, setSpots] = useState<ApiEditionSpotsResponse | null>(null);
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    getEditionSpots(editionId)
      .then((r) => { if (!cancelled) { setSpots(r); setLoading(false); } })
      .catch(() => { if (!cancelled) { setError(true); setLoading(false); } });
    return () => { cancelled = true; };
  }, [editionId]);

  if (error) return null;
  if (loading) return <span className="text-sm text-gray-500">Loading…</span>;
  if (!spots) return null;
  if (spots.both_sold_out) return <span className="pill pill-black">Sold out</span>;
  return (
    <span className="pill">
      Day 1: {spots.day1.remaining} left · Day 2: {spots.day2.remaining} left
    </span>
  );
}

export default LiveSpotsBadge;
```

- [ ] **Step 2: Run tests**

Run: `npm test -- LiveSpotsBadge`
Expected: 3/3 pass (assertions on text content / sold-out text still hold).

- [ ] **Step 3: Commit**

```bash
git add src/components/LiveSpotsBadge.tsx
git commit -m "Phase 1C: LiveSpotsBadge uses .pill classes

Loading state stays neutral text; sold-out → .pill-black; available
state → plain .pill with day counts.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 6: ScheduleDay + schedule page restyle

**Files:**
- Modify: `src/components/ScheduleDay.astro`
- Modify: `src/pages/schedule.astro`

- [ ] **Step 1: Rewrite `src/components/ScheduleDay.astro`**

```astro
---
import type { ScheduleItemRow } from '../lib/types';
export interface Props {
  date: string;
  label: string;
  items: ScheduleItemRow[];
}
const { date, label, items } = Astro.props;
const KIND_PILL: Record<ScheduleItemRow['kind'], string> = {
  workshop:    'pill-teal',
  tournament:  'pill-accent',
  'open-play': 'pill-yellow',
  meal:        'pill-cream',
  talk:        'pill-violet',
};
---
<section class="mb-12">
  <div class="flex items-baseline gap-3 mb-6">
    <h2 class="text-3xl md:text-4xl">{label}</h2>
    <span class="text-sm text-gray-600">{date}</span>
  </div>
  {items.length === 0 ? (
    <p class="text-gray-500">No items yet.</p>
  ) : (
    <div class="flex flex-col gap-4">
      {items.map((i) => (
        <div class="card-brutal p-5 flex flex-col md:flex-row md:items-center md:gap-8">
          <div class="font-mono text-sm font-bold md:w-32 mb-2 md:mb-0">
            {i.start_time.slice(0,5)}–{i.end_time.slice(0,5)}
          </div>
          <div class="flex-1">
            <div class="font-bold text-lg">{i.title}</div>
            {i.location && <div class="text-sm text-gray-600">{i.location}</div>}
            {i.description && <p class="text-sm text-gray-700 mt-1">{i.description}</p>}
          </div>
          <div class="mt-3 md:mt-0">
            <span class={`pill ${KIND_PILL[i.kind]}`}>{i.kind}</span>
          </div>
        </div>
      ))}
    </div>
  )}
</section>
```

- [ ] **Step 2: Rewrite `src/pages/schedule.astro`**

```astro
---
import Layout from '../layouts/Layout.astro';
import ScheduleDay from '../components/ScheduleDay.astro';
import { getCurrentEdition, getScheduleItems } from '../lib/data';

const edition = await getCurrentEdition();
const items = edition ? await getScheduleItems(edition.id) : [];
const day1Items = edition ? items.filter((i) => i.day === edition.start_date) : [];
const day2Items = edition ? items.filter((i) => i.day === edition.end_date) : [];
const title = edition ? `Schedule — ${edition.name}` : 'Schedule — REPLAY';
---
<Layout title={title} description={edition ? `Schedule for ${edition.name}` : 'REPLAY schedule'}>
  <section class="bg-[var(--color-cream-dark)] border-b-4 border-[var(--color-ink)]">
    <div class="container-x section">
      <span class="pill pill-cream mb-4">Schedule</span>
      <h1 class="text-5xl md:text-6xl mb-4">When + where</h1>
      {edition ? (
        <p class="text-gray-700">
          <strong>{edition.name}</strong> · {edition.start_date} – {edition.end_date} · {edition.venue}
        </p>
      ) : (
        <p class="text-gray-600">No upcoming edition right now.</p>
      )}
    </div>
  </section>

  <div class="container-x section">
    {edition && items.length === 0 ? (
      <div class="card-brutal card-brutal-lg p-12 text-center max-w-2xl mx-auto">
        <h2 class="text-3xl mb-2">Schedule coming soon</h2>
        <p class="text-gray-600">Items appear here once the convention's agenda is locked in.</p>
      </div>
    ) : edition && (
      <>
        <ScheduleDay date={edition.start_date} label="Saturday" items={day1Items} />
        <ScheduleDay date={edition.end_date} label="Sunday" items={day2Items} />
      </>
    )}
  </div>
</Layout>
```

- [ ] **Step 3: Build + test**

Run: `npm run build 2>&1 | tail -5 && npm test 2>&1 | tail -3`
Expected: build succeeds; tests 24/24 pass.

- [ ] **Step 4: Commit**

```bash
git add src/components/ScheduleDay.astro src/pages/schedule.astro
git commit -m "Phase 1C: Schedule page restyle with kind pills

Cream-dark heading band on schedule page. Each item in .card-brutal row
with kind pill (workshop=teal, tournament=orange, open-play=yellow,
meal=cream, talk=violet). Empty state in .card-brutal-lg centered.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 7: NotifyMeForm restyle

**Files:**
- Modify: `src/components/NotifyMeForm.tsx`

- [ ] **Step 1: Rewrite `src/components/NotifyMeForm.tsx`**

```tsx
import { useState } from 'react';
import { captureLead } from '../lib/worker';
import type { RegistrationStatus } from '../lib/types';

export interface NotifyMeFormProps {
  editionId: string;
  editionName: string;
  status: Exclude<RegistrationStatus, 'open'>;
}

function sanitize(p: string): string {
  const d = p.replace(/\D/g, '');
  return d.length >= 10 ? d.slice(-10) : '';
}

function copy(status: NotifyMeFormProps['status'], name: string) {
  if (status === 'sold_out') return { heading: `${name} is sold out`, body: 'Want to hear about the next one? Drop your number.' };
  if (status === 'closed')   return { heading: `${name}: registration closed`, body: 'Drop your number and we\'ll email you about the next REPLAY.' };
  return { heading: `${name}: registration opens soon`, body: 'Drop your number and we\'ll email when it opens.' };
}

export function NotifyMeForm({ editionId, editionName, status }: NotifyMeFormProps) {
  const [phone, setPhone] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { heading, body } = copy(status, editionName);

  if (submitted) {
    return (
      <div className="container-x section text-center max-w-md">
        <div className="card-brutal card-brutal-lg p-10">
          <h2 className="text-3xl mb-3">Got it.</h2>
          <p className="text-gray-700">We'll be in touch.</p>
        </div>
      </div>
    );
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const sanitized = sanitize(phone);
    if (!sanitized) { setError('Enter a 10-digit phone number'); return; }
    setError(null);
    setSubmitting(true);
    await captureLead(sanitized, editionId, 'phone_entered');
    setSubmitting(false);
    setSubmitted(true);
  }

  return (
    <div className="container-x section max-w-xl">
      <span className="pill pill-yellow mb-4">Notify me</span>
      <h1 className="text-4xl md:text-5xl mb-3">{heading}</h1>
      <p className="text-gray-700 mb-8 text-lg">{body}</p>
      <form onSubmit={onSubmit} className="card-brutal p-8 space-y-4">
        <div>
          <label htmlFor="phone" className="label-brutal">Phone</label>
          <input
            id="phone"
            type="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            className="input-brutal"
            placeholder="9876543210"
            autoComplete="tel"
          />
          {error && <p className="text-sm text-[var(--color-error)] mt-2">{error}</p>}
        </div>
        <button type="submit" disabled={submitting} className="btn btn-primary btn-block">
          {submitting ? 'Sending…' : 'Notify me'}
        </button>
      </form>
    </div>
  );
}

export default NotifyMeForm;
```

- [ ] **Step 2: Run tests**

Run: `npm test -- NotifyMeForm`
Expected: 4/4 pass. The tests check role/label/text — should survive without changes.

- [ ] **Step 3: Commit**

```bash
git add src/components/NotifyMeForm.tsx
git commit -m "Phase 1C: NotifyMeForm restyle with brutal card + .btn-primary

Yellow notify-me pill above heading; form lives in .card-brutal with
.input-brutal + .btn-primary submit; success state shows .card-brutal-lg
centered.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 8: SuccessScreen + UpiBottomSheet restyle

**Files:**
- Modify: `src/components/SuccessScreen.tsx`
- Modify: `src/components/UpiBottomSheet.tsx`

- [ ] **Step 1: Rewrite `src/components/SuccessScreen.tsx`**

```tsx
export interface SuccessScreenProps {
  pending: boolean;
  editionName: string;
}

export function SuccessScreen({ pending, editionName }: SuccessScreenProps) {
  return (
    <div className="container-x section text-center max-w-xl">
      <div className="card-brutal card-brutal-lg p-10">
        <span className="pill pill-accent mb-4">{pending ? 'Pending' : 'Confirmed'}</span>
        <h2 className="text-4xl mb-4">{pending ? 'Got it.' : "You're in!"}</h2>
        <p className="text-gray-700 mb-8 text-lg">
          {pending
            ? `We'll email you once we confirm your payment for ${editionName}.`
            : `Confirmation for ${editionName} is on its way to your inbox.`}
        </p>
        <a href="/" className="btn btn-secondary">Back to home</a>
      </div>
    </div>
  );
}

export default SuccessScreen;
```

- [ ] **Step 2: Rewrite `src/components/UpiBottomSheet.tsx`**

```tsx
export interface UpiBottomSheetProps {
  amount: number;
  upiId: string;
  payeeName: string;
  transactionRef: string;
  onPaid: () => void;
  onClose: () => void;
}

export function UpiBottomSheet({ amount, upiId, payeeName, transactionRef, onPaid, onClose }: UpiBottomSheetProps) {
  const upiUrl = `upi://pay?pa=${encodeURIComponent(upiId)}&pn=${encodeURIComponent(payeeName)}&am=${amount}&tr=${encodeURIComponent(transactionRef)}&cu=INR`;
  const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=240x240&data=${encodeURIComponent(upiUrl)}`;
  return (
    <div role="dialog" aria-modal="true" className="fixed inset-0 z-50 flex items-end md:items-center justify-center bg-black/50">
      <div className="card-brutal card-brutal-lg bg-[var(--color-paper)] w-full md:max-w-md mx-0 md:mx-6 rounded-b-none md:rounded-2xl p-6">
        <div className="flex justify-between items-start mb-4">
          <div>
            <span className="pill pill-accent mb-2">Pay ₹{amount}</span>
            <h3 className="text-2xl mt-2">Scan or pay manually</h3>
          </div>
          <button onClick={onClose} aria-label="Close" className="text-2xl leading-none font-bold">✕</button>
        </div>
        <div className="card-flat p-3 mb-4 text-center">
          <img src={qrUrl} alt="UPI QR" className="mx-auto" width={240} height={240} />
        </div>
        <div className="space-y-1 mb-4 text-sm">
          <p><strong>UPI ID:</strong> {upiId}</p>
          <p><strong>Amount:</strong> ₹{amount}</p>
        </div>
        <p className="text-xs text-gray-600 mb-4">Pay using any UPI app. Once paid, click below — we'll email you after we confirm the payment manually.</p>
        <button onClick={onPaid} className="btn btn-primary btn-block">I've paid</button>
      </div>
    </div>
  );
}

export default UpiBottomSheet;
```

- [ ] **Step 3: Run tests**

Run: `npm test`
Expected: 24/24 pass. RegisterForm tests check `getByRole('dialog')` + "I've paid" text — both preserved.

- [ ] **Step 4: Commit**

```bash
git add src/components/SuccessScreen.tsx src/components/UpiBottomSheet.tsx
git commit -m "Phase 1C: SuccessScreen + UpiBottomSheet restyle

SuccessScreen wraps content in .card-brutal-lg with status pill + back-
to-home .btn-secondary. UpiBottomSheet uses brutal card with rounded-b-
none on mobile, full rounded on desktop. QR inside a card-flat frame.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 9: RegisterForm restyle

**Files:**
- Modify: `src/components/RegisterForm.tsx`

This is the largest restyle. Keep all state logic and effects identical to Phase 1B; only the JSX `return` block changes.

- [ ] **Step 1: Replace the RegisterForm JSX return block**

Open `src/components/RegisterForm.tsx`. Locate the `return (...)` JSX at the bottom of the `RegisterForm` function. Replace the entire return block from `return (` to the closing `);` with:

```tsx
  return (
    <div className="container-x section max-w-xl">
      <span className="pill pill-yellow mb-4">Register</span>
      <h1 className="text-4xl md:text-5xl mb-3">{edition.name}</h1>
      <p className="text-gray-700 mb-8">{edition.start_date} – {edition.end_date} · {edition.venue}</p>

      {lookup?.user.found && lookup.user.name && (
        <p className="mb-4"><span className="pill pill-teal">Welcome back, {lookup.user.name}</span></p>
      )}
      {lookup?.discount_blocked && (
        <div className="card-flat p-4 mb-4 border-[var(--color-violet)]" style={{ background: '#FFF6E0' }}>
          <p className="text-sm font-medium">
            You've already registered for {edition.name}. Guild Path discount only applies to your first pass.
          </p>
        </div>
      )}
      {tierMsg && !lookup?.discount_blocked && (
        <div className="card-flat p-4 mb-4" style={{ background: '#E8F5F2', borderColor: 'var(--color-teal)' }}>
          <p className="text-sm font-medium">{tierMsg}</p>
        </div>
      )}

      <form onSubmit={onSubmit} className="card-brutal p-8 space-y-5">
        <div>
          <label htmlFor="phone" className="label-brutal">Phone</label>
          <input id="phone" type="tel" autoComplete="tel" value={phone} onChange={(e) => setPhone(e.target.value)}
            className="input-brutal" placeholder="9876543210" />
        </div>
        <div>
          <label htmlFor="name" className="label-brutal">Name</label>
          <input id="name" type="text" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)}
            onBlur={() => scheduleLead('name_entered')}
            className="input-brutal" />
        </div>
        <div>
          <label htmlFor="email" className="label-brutal">Email</label>
          <input id="email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)}
            onBlur={() => scheduleLead('name_entered')}
            className="input-brutal" />
        </div>

        <fieldset>
          <legend className="label-brutal">Pass type</legend>
          <div className="grid grid-cols-2 gap-3">
            <label className={`btn ${passType === 'oneshot' ? 'btn-primary' : 'btn-secondary'} btn-block`}>
              <input type="radio" name="passType" value="oneshot" checked={passType === 'oneshot'} onChange={() => setPassType('oneshot')} className="sr-only" />
              Oneshot ₹{edition.pricing.oneshot.day1}
            </label>
            <label className={`btn ${passType === 'campaign' ? 'btn-primary' : 'btn-secondary'} btn-block ${bothSoldOut ? 'opacity-50 pointer-events-none' : ''}`}>
              <input type="radio" name="passType" value="campaign" checked={passType === 'campaign'} onChange={() => { setPassType('campaign'); setDays(['day1','day2']); }} disabled={bothSoldOut} className="sr-only" />
              Campaign ₹{edition.pricing.campaign}
            </label>
          </div>
        </fieldset>

        {passType === 'oneshot' && (
          <fieldset>
            <legend className="label-brutal">Day</legend>
            <div className="grid grid-cols-2 gap-3">
              <label className={`pill cursor-pointer justify-center py-3 ${days[0] === 'day1' ? 'pill-accent' : ''} ${day1SoldOut ? 'opacity-50' : ''}`}>
                <input type="radio" id="day1" name="day" checked={days[0] === 'day1'} onChange={() => toggleDay('day1')} disabled={day1SoldOut} aria-label="Saturday" className="sr-only" />
                Saturday {day1SoldOut && <span className="text-xs">(sold out)</span>}
              </label>
              <label className={`pill cursor-pointer justify-center py-3 ${days[0] === 'day2' ? 'pill-accent' : ''} ${day2SoldOut ? 'opacity-50' : ''}`}>
                <input type="radio" id="day2" name="day" checked={days[0] === 'day2'} onChange={() => toggleDay('day2')} disabled={day2SoldOut} aria-label="Sunday" className="sr-only" />
                Sunday {day2SoldOut && <span className="text-xs">(sold out)</span>}
              </label>
            </div>
          </fieldset>
        )}

        {base > 0 && (
          <div className="card-flat p-4 bg-[var(--color-cream-dark)] border-l-[6px] border-[var(--color-orange)]">
            <div className="flex justify-between text-sm"><span>Base price</span><span>₹{base}</span></div>
            {discount > 0 && (
              <div className="flex justify-between text-sm text-[var(--color-teal)] font-bold"><span>Discount</span><span>−₹{discount}</span></div>
            )}
            <div className="flex justify-between font-bold text-lg border-t-2 border-[var(--color-ink)] pt-2 mt-2"><span>You pay</span><span>₹{final}</span></div>
          </div>
        )}

        {error && <p className="text-sm text-[var(--color-error)] font-medium">{error}</p>}

        <button type="submit" disabled={submitting || bothSoldOut} className="btn btn-primary btn-block">
          {submitting ? 'Submitting…' : 'Register'}
        </button>
      </form>

      {upiOpen && (
        <UpiBottomSheet
          amount={upiOpen.amount}
          upiId={upiId}
          payeeName="REPLAY Convention"
          transactionRef={upiOpen.regId}
          onPaid={() => { setUpiOpen(null); setSuccess({ pending: true }); }}
          onClose={() => setUpiOpen(null)}
        />
      )}
    </div>
  );
```

The state and useEffect blocks above stay unchanged.

- [ ] **Step 2: Run RegisterForm tests**

Run: `npm test -- RegisterForm`
Expected: 5/5 pass. Assertions check `getByLabelText(/saturday/i)`, `getByText(/welcome back, asha/i)`, `getByText(/already registered/i)`, `getByRole('dialog')`, `getByText(/you're in!/i)` — all preserved in the new markup.

If the "disabled" assertion on the Saturday radio fails because of the new label-wrapping pattern (the `<input class="sr-only">` inside a `<label>`), the test should still find the input by label and `.toBeDisabled()` should still work since the underlying `<input>` has `disabled`. If it doesn't, adjust the test selector to query by `screen.getByRole('radio', { name: /saturday/i })` rather than `getByLabelText`.

- [ ] **Step 3: Run full test suite**

Run: `npm test`
Expected: 24/24 pass.

- [ ] **Step 4: Commit**

```bash
git add src/components/RegisterForm.tsx
git commit -m "Phase 1C: RegisterForm restyle with brutal cards + button radios

Form lives in .card-brutal with .input-brutal fields. Pass type becomes
two big buttons (selected = .btn-primary, unselected = .btn-secondary).
Day radios are pills (.pill / .pill-accent on selection). Discount
preview shows in a cream-dark callout with orange accent line. Anti-
split warning in violet-bordered callout; guild tier preview in teal.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 10: Email template polish

**Files:**
- Modify: `src/emails/registration.html`

- [ ] **Step 1: Replace `src/emails/registration.html` contents**

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>REPLAY — registration confirmed</title>
  </head>
  <body style="margin:0;padding:0;background:#FFF8F0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;color:#1A1A1A;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#FFF8F0;padding:32px 0;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:12px;overflow:hidden;border:3px solid #1A1A1A;box-shadow:6px 6px 0 #1A1A1A;">
            <tr>
              <td style="background:#F47B20;color:#ffffff;padding:24px 32px;border-bottom:3px solid #1A1A1A;">
                <div style="font-size:14px;letter-spacing:.15em;text-transform:uppercase;opacity:.9;font-weight:700;">REPLAY</div>
                <div style="font-size:26px;font-weight:700;margin-top:4px;">You're in for {{edition_name}}</div>
                <div style="margin-top:10px;">
                  <span style="display:inline-block;background:#FFD166;color:#1A1A1A;padding:4px 10px;border-radius:999px;border:2px solid #1A1A1A;font-size:12px;font-weight:700;margin-right:6px;">{{pass_type}}</span>
                  <span style="display:inline-block;background:#FFFFFF;color:#1A1A1A;padding:4px 10px;border-radius:999px;border:2px solid #1A1A1A;font-size:12px;font-weight:700;">{{days_label}}</span>
                </div>
              </td>
            </tr>
            <tr>
              <td style="padding:24px 32px 8px 32px;">
                <p style="margin:0 0 16px 0;font-size:16px;">Hey {{name}},</p>
                <p style="margin:0 0 16px 0;font-size:16px;line-height:1.5;">
                  Your registration for <strong>{{edition_name}}</strong> is confirmed. See you at {{venue}} on {{days_label}} ({{start_date}} &ndash; {{end_date}}).
                </p>
              </td>
            </tr>
            <tr>
              <td style="padding:8px 32px 24px 32px;">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:2px solid #1A1A1A;border-radius:8px;">
                  <tr>
                    <td style="padding:12px 16px;font-size:14px;border-bottom:2px solid #1A1A1A;"><strong>Pass</strong></td>
                    <td style="padding:12px 16px;font-size:14px;border-bottom:2px solid #1A1A1A;">{{pass_type}} &mdash; {{days_label}}</td>
                  </tr>
                  <tr>
                    <td style="padding:12px 16px;font-size:14px;border-bottom:2px solid #1A1A1A;"><strong>Seats</strong></td>
                    <td style="padding:12px 16px;font-size:14px;border-bottom:2px solid #1A1A1A;">{{seats}}</td>
                  </tr>
                  <tr>
                    <td style="padding:12px 16px;font-size:14px;border-bottom:2px solid #1A1A1A;"><strong>Amount paid</strong></td>
                    <td style="padding:12px 16px;font-size:14px;border-bottom:2px solid #1A1A1A;">&#8377;{{amount_paid}}</td>
                  </tr>
                  <tr>
                    <td style="padding:12px 16px;font-size:14px;border-bottom:2px solid #1A1A1A;"><strong>Discount</strong></td>
                    <td style="padding:12px 16px;font-size:14px;border-bottom:2px solid #1A1A1A;">&#8377;{{discount_applied}}</td>
                  </tr>
                  <tr>
                    <td style="padding:12px 16px;font-size:14px;"><strong>Guild Path</strong></td>
                    <td style="padding:12px 16px;font-size:14px;">{{guild_tier}}</td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td style="padding:8px 32px 28px 32px;font-size:13px;color:#666;line-height:1.5;">
                Reply to this email if anything looks off. We'll be in touch closer to the convention with venue + schedule details.
                <br/><br/>
                &mdash; Team REPLAY
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>
```

- [ ] **Step 2: Verify GAS still picks up the template URL**

The Replay Apps Script project's URL points at `…/rebuild/phase-0/src/emails/registration.html` (set in Phase 1A Task 12). Once this commit lands on origin, GAS's `UrlFetchApp.fetch` will get the new HTML on the next webhook call.

No code change needed.

- [ ] **Step 3: Commit**

```bash
git add src/emails/registration.html
git commit -m "Phase 1C: Email template polish — system fonts + hard shadow + pills

System font stack replaces Inter/Space Grotesk (Google fonts don't
reliably load in email clients). Card gets thick brutal border + 6px
offset shadow. Header strip gains pass-type (yellow) and day-label
(white) pills under the heading.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 11: Deploy + manual smoke walkthrough

**Files:** none modified.

- [ ] **Step 1: Push branch**

Run:
```bash
cd /Users/siddhantnarula/Projects/replay-website
git push
```

Cloudflare Pages auto-deploys. Wait ~60s for build.

- [ ] **Step 2: Poll until styled site is live**

Use the context-mode JS executor to poll `https://replay-website.pages.dev/` until it contains a brutalist class marker. Example check string: `card-brutal` or `replay-wordmark` or `box-shadow: 6px 6px 0 #1A1A1A` (inline somewhere from the build).

- [ ] **Step 3: Visual smoke (user)**

Visit `https://replay-website.pages.dev/` in a browser and verify:
- Header sticks; REPLAY wordmark in orange; nav buttons brutal.
- Hero: text left, photo right (mobile: photo on top, text below).
- "About REPLAY" section has paper bg with thick top/bottom borders.
- Sponsors section absent (none seeded).
- Register CTA shows orange "Get notified" button; live spots badge below in a pill.
- Footer: mailto + Instagram + copyright; thick top border.
- `/schedule`: cream-dark heading band + "Schedule coming soon" card.
- `/register`: NotifyMeForm with brutal card + orange button.

- [ ] **Step 4: Flip status='open' temporarily for register-form smoke**

Use the Supabase MCP `execute_sql` against project `qvkynwlmzeybdiapbcsy`:

```sql
update editions set registration_status = 'open' where slug = 'replay-3';
```

Then fire the deploy hook to rebuild:

```javascript
await fetch('https://api.cloudflare.com/client/v4/pages/webhooks/deploy_hooks/01e9488c-00cc-4c38-aa87-9be5820a51f7', { method: 'POST' });
```

Wait ~60s. Visit `/register` — should now show the styled form.

- [ ] **Step 5: Walk the form (user, in browser)**

- Type a phone → form should accept brutal input style.
- Type name + email → fields styled, focus state thickens shadow.
- Pass type: Oneshot/Campaign buttons toggle (selected = orange filled).
- Day pills toggle (selected = orange filled).
- Price preview appears in cream-dark callout with orange accent line.
- Click Register → UPI sheet slides up with brutal border + QR in framed card.
- Click "I've paid" → SuccessScreen card.

- [ ] **Step 6: Revert and cleanup**

```sql
update editions set registration_status = 'upcoming' where slug = 'replay-3';
delete from registrations where user_phone IN ('<any test phones>');
delete from leads where phone IN ('<any test phones>');
delete from users where phone IN ('<any test phones>');
```

Fire deploy hook again to rebuild with status=upcoming.

---

## Task 12: CLAUDE.md learnings

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Append entries**

Add at the bottom of `CLAUDE.md` under "Session learnings":

```markdown
- 2026-05-22 — Phase 1C shipped: design overhaul. REPLAY palette in Tailwind 4 `@theme` (orange anchor, teal/yellow/violet accents on cream). Brutalist utility classes (`.btn`, `.card-brutal`, `.pill`, `.input-brutal`) ported from bgc with palette swap (`.btn-secondary` hover = teal, not bgc's pink). Hero is split text/photo; photo path lives in `landing/hero.mdx` frontmatter (`photo` field). **Why it matters:** new contributors should reach for the utility classes in `global.css` rather than reinvent brutalism inline; if you need a new variant, add it to global.css so it's reusable across Astro + JSX.
- 2026-05-22 — Schedule kind pills: workshop→teal, tournament→orange, open-play→yellow, meal→cream, talk→violet. Map lives in `ScheduleDay.astro`. **Why it matters:** adding a new `schedule_items.kind` value requires updating both the DB check constraint (migration) and the pill-color map.
- 2026-05-22 — Email template uses a system font stack (`-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, ...`) instead of Inter/Space Grotesk. **Why it matters:** Gmail / Outlook reliably ignore web fonts. System stack ensures consistent rendering. Don't try to "fix" this by adding Google Fonts to the email.
```

- [ ] **Step 2: Commit + push**

```bash
git add CLAUDE.md
git commit -m "Document Phase 1C design overhaul learnings

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
git push
```

---

## Definition of Done

- [ ] `npm run build` succeeds at repo root.
- [ ] `npm test` green (24/24).
- [ ] `cd worker && npm test` still green (66/66).
- [ ] Site live at `replay-website.pages.dev` with brutalist design system.
- [ ] Hero photo renders right side on desktop (`/carousel-photos/3.jpeg` by default).
- [ ] Header sticky with REPLAY wordmark + nav buttons.
- [ ] Footer has Instagram link + mailto + copyright.
- [ ] Schedule page has kind pills colored per the map.
- [ ] Email template uses system fonts + has pass-type + day pills (verified visually by user via a synthetic test registration).
- [ ] Status='upcoming' reverted; smoke users/registrations/leads cleaned up.
- [ ] CLAUDE.md updated.
- [ ] All commits pushed to `origin/rebuild/phase-0`.
