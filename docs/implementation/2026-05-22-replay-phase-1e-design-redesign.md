# REPLAY Phase 1E — Visual Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Design generation:** For Tasks 4-7 (the visual component + page builds), the implementer must invoke the `frontend-design` skill via `Skill(skill='frontend-design:frontend-design', ...)` to generate high-quality visual code within the constraints defined in each task. The constraints below specify the design tokens, component props, accessibility requirements, and acceptance criteria; the frontend-design skill produces the polished JSX/CSS within those bounds.

**Goal:** Restyle the entire replay site (landing + register + schedule) to match the bgc-website design language — same palette, same layout patterns (dark slab hero, photo band, editorial stripes, dark CTA bands, orange CTA finish), same typography scale. Ship from a feature branch via PR.

**Architecture:** Visual layer only. New tokens in `global.css`, 4 new Astro shared components ported/adapted from bgc, 3 page rebuilds composing those components, palette consistency sweep on existing islands. No worker / schema / data changes.

**Tech Stack:** Astro 6 + React 19, Tailwind 4 (`@theme` tokens + CSS utility classes), Astro `Image` for photo optimization, Vitest (existing 24+66 tests should stay green throughout).

**Branch:** new feature branch `redesign/phase-1e` off `main`. Merges back to `main` at end via PR.

**Working directory:** `/Users/siddhantnarula/Projects/replay-website`.

---

## File Structure

```
NEW shared components (Astro):
src/components/HeroPhotoBand.astro
src/components/EditorialStripe.astro
src/components/DarkBand.astro
src/components/SponsorsBand.astro

MODIFIED (full rewrite):
src/styles/global.css                       (palette tokens swap; new utility classes)
src/pages/index.astro                       (9-section composition)
src/pages/register.astro                    (cream header + orange-stripe brutal card)
src/pages/schedule.astro                    (cream header + timeline)
src/components/ScheduleDay.astro            (timeline pattern with bgc kind colors)

PALETTE SWEEP (small modifications):
src/components/NotifyMeForm.tsx             (drop teal/violet refs)
src/components/RegisterForm.tsx             (drop teal/violet refs; green guild banner, pink anti-split)
src/components/SuccessScreen.tsx            (no changes expected; verify)
src/components/UpiBottomSheet.tsx           (no changes expected; verify)
src/components/LiveSpotsBadge.tsx           (no changes expected; verify)

PHOTO REORG:
public/carousel-photos/{1-7}.jpeg           (delete after move)
src/assets/landing/hero-band-{1,2,3}.jpeg   (new — 3 picked for HeroPhotoBand)
src/assets/landing/stripe-event.jpeg        (new — for EditorialStripe 01)
src/assets/landing/stripe-games.jpeg        (new — for EditorialStripe 02)
src/assets/landing/stripe-community.jpeg    (new — for EditorialStripe 03)
src/assets/landing/closing-cta.jpeg         (new — orange CTA backdrop)

CONTENT collection — hero.mdx no longer needs photo field (replaced by HeroPhotoBand below dark hero); leave field optional, mark unused

UNCHANGED:
worker/                                     (no worker code touched)
supabase/migrations/                        (no schema changes)
src/lib/                                    (no data layer changes)
admin/                                      (Phase 3)
src/emails/registration.html                (Phase 1F)
```

**Boundary rules:**
- `global.css` remains the single source for tokens + utility classes.
- The 4 new shared components are the ONLY components that know bgc's specific layout patterns. Pages consume them as props-driven composition.
- Photo paths flow through Astro `Image` (`import` syntax), not raw `<img src>`, for build-time optimization.

---

## Task 1: Branch + photo reorganization

**Files:**
- Create branch: `redesign/phase-1e`
- Move: `public/carousel-photos/*.jpeg` → `src/assets/landing/*.jpeg`
- Delete: `public/carousel-photos/.DS_Store`

- [ ] **Step 1: Create feature branch off main**

Run:
```bash
cd /Users/siddhantnarula/Projects/replay-website
git checkout main
git pull
git checkout -b redesign/phase-1e
```

Expected: on branch `redesign/phase-1e`.

- [ ] **Step 2: Inspect the 7 photos before assignment**

Quickly view each photo to decide which goes where. Easiest: `open public/carousel-photos/` in Finder to thumbnail-preview, or write a simple HTML viewer:

```bash
cat > /tmp/photo-grid.html <<'EOF'
<!doctype html>
<html><head><style>
  body { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; padding: 12px; font-family: system-ui; background: #1a1a1a; color: #fff; }
  figure { margin: 0; }
  img { width: 100%; height: 280px; object-fit: cover; border: 2px solid #555; }
  figcaption { font-size: 12px; padding: 4px 0; }
</style></head><body>
  <figure><img src="file:///Users/siddhantnarula/Projects/replay-website/public/carousel-photos/1.jpeg"><figcaption>1.jpeg</figcaption></figure>
  <figure><img src="file:///Users/siddhantnarula/Projects/replay-website/public/carousel-photos/2.jpeg"><figcaption>2.jpeg</figcaption></figure>
  <figure><img src="file:///Users/siddhantnarula/Projects/replay-website/public/carousel-photos/3.jpeg"><figcaption>3.jpeg</figcaption></figure>
  <figure><img src="file:///Users/siddhantnarula/Projects/replay-website/public/carousel-photos/4.jpeg"><figcaption>4.jpeg</figcaption></figure>
  <figure><img src="file:///Users/siddhantnarula/Projects/replay-website/public/carousel-photos/5.jpeg"><figcaption>5.jpeg</figcaption></figure>
  <figure><img src="file:///Users/siddhantnarula/Projects/replay-website/public/carousel-photos/6.jpeg"><figcaption>6.jpeg</figcaption></figure>
  <figure><img src="file:///Users/siddhantnarula/Projects/replay-website/public/carousel-photos/7.jpeg"><figcaption>7.jpeg</figcaption></figure>
</body></html>
EOF
open /tmp/photo-grid.html
```

Decide assignment based on content. Rough criteria:
- `hero-band-{1,2,3}`: any 3 wide-vibe shots (people playing, crowd, action)
- `stripe-event`: shot that conveys "the event" — wide room shot or crowd
- `stripe-games`: shot featuring game boards, components, or close-ups of play
- `stripe-community`: group/people-focused shot, faces ideally
- `closing-cta`: a more atmospheric/moody shot; will be at 18% opacity behind text so detail doesn't matter

If a slot doesn't have an ideal photo, pick the closest one — the spec is flexible here.

- [ ] **Step 3: Move + rename the photos**

Run:
```bash
mkdir -p src/assets/landing
# Replace the rhs filenames below with your chosen assignments per Step 2.
# Example assignment (adjust as needed):
git mv public/carousel-photos/1.jpeg src/assets/landing/hero-band-1.jpeg
git mv public/carousel-photos/2.jpeg src/assets/landing/hero-band-2.jpeg
git mv public/carousel-photos/3.jpeg src/assets/landing/hero-band-3.jpeg
git mv public/carousel-photos/4.jpeg src/assets/landing/stripe-event.jpeg
git mv public/carousel-photos/5.jpeg src/assets/landing/stripe-games.jpeg
git mv public/carousel-photos/6.jpeg src/assets/landing/stripe-community.jpeg
git mv public/carousel-photos/7.jpeg src/assets/landing/closing-cta.jpeg
rm -f public/carousel-photos/.DS_Store
rmdir public/carousel-photos
```

Verify all 7 photos landed in `src/assets/landing/` and `public/carousel-photos/` is gone:
```bash
ls src/assets/landing/ && ls public/carousel-photos/ 2>&1 | head -3
```

- [ ] **Step 4: Update the existing reference in hero.mdx**

`src/content/landing/hero.mdx` currently has `photo: "/carousel-photos/3.jpeg"` in frontmatter (added in 1C). This is no longer used (HeroPhotoBand replaces the single hero photo). Either remove the field or leave it harmless. Remove it for cleanliness:

```mdx
---
eyebrow: "Bangalore"
title: "A weekend of board games."
subtitle: "Two days. Hundreds of players. One library of 200+ games. Beginners welcome."
---
```

(Drop the `photo` line.)

- [ ] **Step 5: Update `src/content.config.ts` to drop `photo` field**

```ts
import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

const landing = defineCollection({
  loader: glob({ pattern: '**/*.mdx', base: './src/content/landing' }),
  schema: z.object({
    eyebrow: z.string().optional(),
    title: z.string().optional(),
    subtitle: z.string().optional(),
  }),
});

export const collections = { landing };
```

- [ ] **Step 6: Verify build still works**

Run:
```bash
npm run build 2>&1 | tail -5
```

Expected: build succeeds. (HeroSection.astro still references `data.photo` — it'll just be undefined now since we dropped the field. Astro renders the conditional `{data.photo && ...}` block as nothing. Fine.)

- [ ] **Step 7: Commit**

```bash
git add src/assets/landing/ public/carousel-photos/ src/content.config.ts src/content/landing/hero.mdx
git commit -m "Phase 1E Task 1: Reorganize photos for new landing composition

Move 7 photos from public/carousel-photos/ into src/assets/landing/
and rename per intended slot (hero-band-{1,2,3}, stripe-event,
stripe-games, stripe-community, closing-cta). Astro Image will pull
them from src/assets/ for build-time optimization. Drop the now-unused
photo field from landing collection schema.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 2: Palette tokens + utility classes (global.css)

**Files:**
- Modify (full rewrite of the @theme + new utility classes): `src/styles/global.css`

- [ ] **Step 1: Replace `src/styles/global.css` contents**

```css
@import "tailwindcss";

@theme {
  /* REPLAY palette — fully matches bgc */
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
.btn-secondary:hover { background: #FF6B6B; color: #1A1A1A; box-shadow: var(--shadow-lg); }

.btn-black { background: #1A1A1A; color: #FFFFFF; box-shadow: var(--shadow-sm); }
.btn-black:hover { box-shadow: var(--shadow-md); }

.btn-outline-white {
  background: transparent; color: #FFFFFF; border: 4px solid #FFFFFF;
}
.btn-outline-white:hover { background: #FFFFFF; color: #1A1A1A; }

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
  display: inline-flex; align-items: center; gap: 6px;
  padding: 4px 12px;
  font-family: var(--font-heading); font-size: 0.8rem; font-weight: 700;
  border: 2px solid #1A1A1A; border-radius: 999px;
  background: #FFFFFF; color: #1A1A1A;
}
.pill-accent { background: #F47B20; color: #FFFFFF; }
.pill-black  { background: #1A1A1A; color: #FFFFFF; }
.pill-yellow { background: #FFD166; color: #1A1A1A; }
.pill-pink   { background: #FF6B6B; color: #1A1A1A; }
.pill-blue   { background: #4ECDC4; color: #1A1A1A; }
.pill-green  { background: #A8E6CF; color: #1A1A1A; }
.pill-purple { background: #C3A6FF; color: #1A1A1A; }
.pill-cream  { background: #F0E6D8; color: #1A1A1A; }

/* ---------- Inputs ---------- */
.input-brutal {
  width: 100%; padding: 12px 14px;
  border: var(--border); border-radius: var(--radius-md);
  background: #FFFFFF; font-family: var(--font-body); font-size: 1rem; color: #1A1A1A;
  box-shadow: var(--shadow-sm); transition: box-shadow 0.15s;
}
.input-brutal:focus { outline: none; box-shadow: var(--shadow-md); }
.input-brutal::placeholder { color: #1A1A1A; opacity: 0.45; }
.input-brutal:disabled { opacity: 0.5; cursor: not-allowed; }

/* ---------- Labels ---------- */
.label-brutal {
  display: block;
  font-family: var(--font-heading); font-size: 0.85rem; font-weight: 700;
  text-transform: uppercase; letter-spacing: 0.05em;
  margin-bottom: 6px;
}

/* ---------- Section + container ---------- */
.section { padding: 64px 24px; }
.container-x { max-width: 1200px; margin: 0 auto; }

/* ---------- Section tag (ported from bgc) ---------- */
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

**Changes vs 1C:**
- Removed `--color-teal`, `--color-violet`, `--color-orange-light`
- Cream `#FFF8F0` → `#FFF8E7`
- `.btn-secondary` hover swapped to pink
- New `.btn-outline-white` variant for dark-band CTAs
- Added `.pill-pink`, `.pill-blue`, `.pill-green`, `.pill-purple`; removed `.pill-teal`, `.pill-violet`
- `.container-x` widened from `1024px` to `1200px` (matches bgc)
- New `.section-tag` class

- [ ] **Step 2: Run build to catch any unresolved palette references**

```bash
npm run build 2>&1 | tail -10
```

Expected: build succeeds. Any "unknown CSS variable" or compile errors will surface here — investigate before continuing.

- [ ] **Step 3: Run tests**

```bash
npm test 2>&1 | tail -5
```

Expected: 24/24 pass (test assertions are semantic, unaffected by token swaps).

- [ ] **Step 4: Commit**

```bash
git add src/styles/global.css
git commit -m "Phase 1E Task 2: Palette swap to bgc-matching + .section-tag utility

Drop replay-distinct teal+violet. Adopt bgc's full palette (orange +
pink + blue + green + purple + yellow + cream #FFF8E7). Add
.btn-outline-white for dark-band CTAs and .section-tag for editorial
section eyebrows. Widen .container-x to 1200px (bgc value).

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 3: Build `<HeroPhotoBand>` shared component

**Files:**
- Create: `src/components/HeroPhotoBand.astro`

> **Invoke** `Skill(skill='frontend-design:frontend-design', ...)` for this task. The constraints below define the design + props; the skill produces the polished implementation.

**Frontend-design skill input prompt (use verbatim or adapt):**
> Build an Astro component `src/components/HeroPhotoBand.astro` that renders an edge-to-edge band of 3 photos beneath a dark hero section. Photos passed in as `photos: ImageMetadata[]` (Astro image imports). Desktop: 3 equal-width columns, photos `object-cover` and consistent height (e.g. 280px). Mobile: horizontal scroll with `scroll-snap-type: x mandatory`, each photo at near-screen width. No internal padding (the band is meant to butt directly against the dark hero above and the content below). 4px-thick black top + bottom borders, matching bgc's brutalist style. Use Astro's `<Image>` component (`import { Image } from 'astro:assets'`) for build-time optimization, widths `[600, 1200]`, sizes `(min-width: 768px) 33vw, 80vw`. Photos have `aria-hidden="true"` since they're decorative atmosphere.

**Constraints:**

```ts
// Props
export interface Props {
  photos: ImageMetadata[];  // expected length 3
}
```

**Reference structure** (the skill should produce something equivalent or better):

```astro
---
import { Image } from 'astro:assets';
import type { ImageMetadata } from 'astro';
export interface Props { photos: ImageMetadata[] }
const { photos } = Astro.props;
---
<div class="hero-photo-band" aria-hidden="true">
  <div class="hero-photo-band-track">
    {photos.slice(0, 3).map((p) => (
      <Image src={p} alt="" widths={[600, 1200]} sizes="(min-width: 768px) 33vw, 80vw" class="hero-photo-band-img" />
    ))}
  </div>
</div>

<style>
  .hero-photo-band {
    border-top: 4px solid var(--color-ink);
    border-bottom: 4px solid var(--color-ink);
    overflow-x: auto;
    overflow-y: hidden;
    -webkit-overflow-scrolling: touch;
    scroll-snap-type: x mandatory;
  }
  .hero-photo-band-track {
    display: grid;
    grid-template-columns: repeat(3, minmax(80vw, 1fr));
    gap: 0;
  }
  @media (min-width: 768px) {
    .hero-photo-band-track {
      grid-template-columns: repeat(3, 1fr);
    }
  }
  .hero-photo-band-img {
    width: 100%;
    height: 280px;
    object-fit: cover;
    scroll-snap-align: start;
    display: block;
  }
  @media (min-width: 768px) {
    .hero-photo-band-img { height: 360px; }
  }
</style>
```

The frontend-design skill may produce a more refined version with better motion, hover states, or aspect ratio handling. Accept what it produces if it meets the constraints.

- [ ] **Step 1: Invoke the frontend-design skill**

Provide the skill the prompt + constraints above. Save the resulting code to `src/components/HeroPhotoBand.astro`.

- [ ] **Step 2: Smoke-test by creating a throwaway preview**

Temporarily add to `src/pages/index.astro` (will be replaced in Task 6, but useful here):

```astro
---
import HeroPhotoBand from '../components/HeroPhotoBand.astro';
import photo1 from '../assets/landing/hero-band-1.jpeg';
import photo2 from '../assets/landing/hero-band-2.jpeg';
import photo3 from '../assets/landing/hero-band-3.jpeg';
---
<HeroPhotoBand photos={[photo1, photo2, photo3]} />
```

Run: `npm run dev` and visit `http://localhost:4321/`. Confirm 3 photos render edge-to-edge. Revert the index.astro change before committing.

- [ ] **Step 3: Build verify**

```bash
npm run build 2>&1 | tail -5
```

Expected: build green; Astro image optimization produces multiple sizes per photo.

- [ ] **Step 4: Commit**

```bash
git add src/components/HeroPhotoBand.astro
git commit -m "Phase 1E Task 3: HeroPhotoBand component

Edge-to-edge band of 3 photos using Astro Image. Desktop = 3 cols
equal-width; mobile = scroll-snap. 4px black top/bottom borders match
bgc brutalism. Built via frontend-design skill.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 4: Build `<EditorialStripe>` shared component

**Files:**
- Create: `src/components/EditorialStripe.astro`

> **Invoke** `Skill(skill='frontend-design:frontend-design', ...)` for this task.

**Frontend-design skill input prompt:**
> Build an Astro component `src/components/EditorialStripe.astro` for replay-website that ports bgc-website's EditorialStripe pattern. 2-column grid on desktop (max-width 1200px). One column has a large numbered label like "01 / EVENT" in big tracked uppercase, then a heading (clamp 2-4rem, Space Grotesk bold), body text, then a CTA button. Other column has a single full-bleed photo with brutal border + offset shadow. Photo can be on left or right (`photoSide` prop). Section background = `bgColor` prop (one of bgc palette colors). Mobile: stack vertically, photo on top. Use Astro `<Image>` for the photo.

**Constraints:**

```ts
export interface Props {
  number: string;            // e.g. "01"
  label: string;             // e.g. "THE EVENT"
  heading?: string;          // OR use the `heading` slot for richer content
  body: string;
  ctaText: string;
  ctaHref: string;
  ctaExternal?: boolean;
  bgColor: string;           // bgc palette hex
  photo: ImageMetadata;
  photoAlt: string;
  photoSide: 'left' | 'right';
}
```

CTA renders as `<a href={ctaHref} target={ctaExternal ? '_blank' : undefined} rel={ctaExternal ? 'noopener' : undefined} class="btn btn-black">{ctaText}</a>`.

Number + label render as a single line: `<div class="stripe-eyebrow">01 / EVENT</div>` styled with font-weight 700, letter-spacing 0.15em, font-size 13px.

Heading uses `clamp(2rem, 5vw, 4rem)` and Space Grotesk.

Photo has `border: 4px solid var(--color-ink)`, `box-shadow: var(--shadow-lg)`, `aspect-ratio: 4/5` on desktop, `aspect-ratio: 16/10` on mobile. Astro `<Image>` widths `[400, 800, 1200]`, sizes `(min-width: 768px) 40vw, 90vw`.

- [ ] **Step 1: Invoke the frontend-design skill**

Generate code per constraints above. Output to `src/components/EditorialStripe.astro`.

- [ ] **Step 2: Smoke-test**

Temporarily add to a scratch route (e.g. create `src/pages/_scratch.astro`):

```astro
---
import EditorialStripe from '../components/EditorialStripe.astro';
import photo from '../assets/landing/stripe-event.jpeg';
---
<html><body>
<EditorialStripe number="01" label="THE EVENT"
  heading="Two days. One library. Hundreds of games in motion."
  body="Show up Saturday, leave Sunday with three new friends..."
  ctaText="See the schedule →" ctaHref="/schedule"
  bgColor="#FFD166" photo={photo} photoAlt="Crowd playing" photoSide="left" />
</body></html>
```

Visit `http://localhost:4321/_scratch` to confirm. Then `git rm src/pages/_scratch.astro` (don't commit it).

- [ ] **Step 3: Build verify + commit**

```bash
npm run build 2>&1 | tail -5
rm -f src/pages/_scratch.astro 2>/dev/null
git add src/components/EditorialStripe.astro
git commit -m "Phase 1E Task 4: EditorialStripe component

Bgc-pattern editorial section: 2-col grid (number+label+heading+body+
CTA on one side, big photo on other). Background = bgColor prop.
photoSide controls left/right alternation. Mobile stacks photo above
text. Built via frontend-design skill.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 5: Build `<DarkBand>` and `<SponsorsBand>` shared components

**Files:**
- Create: `src/components/DarkBand.astro`
- Create: `src/components/SponsorsBand.astro`

> **Invoke** `Skill(skill='frontend-design:frontend-design', ...)` once for both — they're related (both stack-able full-width sections with brand-band feel).

### `<DarkBand>` constraints

```ts
export interface Props {
  eyebrow?: string;          // optional small bright-color tag (e.g. "▸ FOR REGULARS")
  eyebrowColor?: string;     // default '#FFFFFF'; override e.g. var(--color-yellow)
  heading: string;
  body?: string;
  cta?: { text: string; href: string; variant?: 'primary' | 'outline-white'; external?: boolean };
  cta2?: { text: string; href: string; variant?: 'primary' | 'outline-white'; external?: boolean };
}
```

Background `#1A1A1A`. Container `.container-x` with `py-16 md:py-24`. Eyebrow uses font-weight 600, tracked, color from `eyebrowColor`. Heading uses `clamp(2.2rem, 7vw, 5rem)`, color white, `letter-spacing: -1.5px`. Body color `rgba(255,255,255,0.7)`, max-width `xl`. CTAs render via `.btn` classes; `variant='primary'` → `.btn-primary`, `variant='outline-white'` → `.btn-outline-white`.

### `<SponsorsBand>` constraints

```ts
import type { SponsorRow } from '../lib/types';
export interface Props { sponsors: SponsorRow[] }
```

Hidden if `sponsors.length === 0` (early return null).

Layout:
- Section bg `var(--color-cream)`, with thick borders top + bottom (`border-top: 4px solid var(--color-ink); border-bottom: 4px solid var(--color-ink);`).
- Container `.container-x`. Eyebrow: `<span class="section-tag" style="background: var(--color-yellow); color: var(--color-ink);">SPONSORS</span>`.
- Heading: `<h2 style="font-size: clamp(2rem, 5vw, 3.5rem);">Backed by</h2>`.
- Tier sections in order: title, gold, silver, partner. Each tier has a small label (e.g. `<div class="text-sm uppercase tracking-widest text-gray-600 mb-3">Title sponsor</div>`), then a grid of `.card-brutal` cards containing logo images:
  - **title**: 1 column, `card-brutal-lg`, logo h-32, max-w-md centered
  - **gold**: 3 columns grid (mobile 2), `card-brutal`, logo h-20
  - **silver**: 4 columns grid (mobile 2), `card-brutal`, logo h-16
  - **partner**: 5-6 columns grid (mobile 3), `card-brutal`, logo h-14

Each logo card is `<a>` if `website_url` present, `<div>` otherwise. `<img>` with `object-contain` and `alt={sponsor.name}`.

- [ ] **Step 1: Invoke frontend-design for `<DarkBand>`**

Generate code per constraints. Save to `src/components/DarkBand.astro`.

- [ ] **Step 2: Invoke frontend-design for `<SponsorsBand>`**

Generate code per constraints. Save to `src/components/SponsorsBand.astro`.

- [ ] **Step 3: Build verify**

```bash
npm run build 2>&1 | tail -5 && npm test 2>&1 | tail -3
```

Expected: build green; 24/24 tests still pass.

- [ ] **Step 4: Commit**

```bash
git add src/components/DarkBand.astro src/components/SponsorsBand.astro
git commit -m "Phase 1E Task 5: DarkBand + SponsorsBand components

DarkBand: reusable #1A1A1A slab with optional eyebrow, big heading,
body, and up to 2 CTAs (primary or outline-white variants). Used for
landing hero, Guild Path teaser, and closing CTAs.

SponsorsBand: tier-stacked sponsor logos in card-brutal containers,
cream bg with thick borders. Hidden when empty.

Both built via frontend-design skill.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 6: Rebuild landing page (`/`)

**Files:**
- Modify (full rewrite): `src/pages/index.astro`

> **Invoke** `Skill(skill='frontend-design:frontend-design', ...)` for polishing the composition + the inline orange CTA finish (the only non-component-based section).

**Frontend-design skill input prompt:**
> Rebuild `src/pages/index.astro` to compose the 9-section bgc-arc landing page for REPLAY. Use the shared components built in Phase 1E Tasks 3-5: `<DarkBand>`, `<HeroPhotoBand>`, `<EditorialStripe>`, `<SponsorsBand>`. The final section (orange CTA finish) is inline JSX in the page — a section with bg-orange + photo backdrop at 18% opacity behind text, big "See you in September." heading + edition meta + one `.btn-black` CTA. Use Astro `<Image>` for the backdrop photo. Page receives edition + sponsors from `getCurrentEdition` and `getSponsors`. Live edition meta band between HeroPhotoBand and editorial stripes 1-3 contains the `<LiveSpotsBadge>` React island.

**Composition** (the skill produces something equivalent):

```astro
---
import Layout from '../layouts/Layout.astro';
import DarkBand from '../components/DarkBand.astro';
import HeroPhotoBand from '../components/HeroPhotoBand.astro';
import EditorialStripe from '../components/EditorialStripe.astro';
import SponsorsBand from '../components/SponsorsBand.astro';
import LiveSpotsBadge from '../components/LiveSpotsBadge';
import { Image } from 'astro:assets';
import hero1 from '../assets/landing/hero-band-1.jpeg';
import hero2 from '../assets/landing/hero-band-2.jpeg';
import hero3 from '../assets/landing/hero-band-3.jpeg';
import stripeEvent from '../assets/landing/stripe-event.jpeg';
import stripeGames from '../assets/landing/stripe-games.jpeg';
import stripeCommunity from '../assets/landing/stripe-community.jpeg';
import closingPhoto from '../assets/landing/closing-cta.jpeg';
import { getCurrentEdition, getSponsors } from '../lib/data';

const edition = await getCurrentEdition();
const sponsors = edition ? await getSponsors(edition.id) : [];
const title = edition ? `${edition.name} — Bangalore's board game convention` : 'REPLAY — Bangalore';

const heroCta = edition?.registration_status === 'open'
  ? { text: 'Register now →', href: '/register', variant: 'primary' as const }
  : { text: 'Get notified →', href: '/register', variant: 'primary' as const };
---
<Layout title={title}>
  <!-- 1. Dark hero -->
  <DarkBand
    heading="A weekend of board games."
    body="Two days. Hundreds of players. 200+ games. Beginners welcome."
    cta={edition ? heroCta : undefined}
    cta2={edition ? { text: 'See past photos', href: '#community', variant: 'outline-white' } : undefined}
  />

  <!-- 2. Hero photo band -->
  <HeroPhotoBand photos={[hero1, hero2, hero3]} />

  <!-- 3. Edition meta band -->
  {edition && (
    <section style="background: var(--color-cream); border-bottom: 4px solid var(--color-ink);">
      <div class="container-x px-6 py-10 text-center">
        <span class="section-tag">{edition.name}</span>
        <p class="text-lg md:text-xl mt-2">
          <strong>{edition.start_date}</strong> &ndash; <strong>{edition.end_date}</strong> · {edition.venue}
        </p>
        <div class="mt-4 flex justify-center">
          <LiveSpotsBadge client:load editionId={edition.id} />
        </div>
      </div>
    </section>
  )}

  <!-- 4. Editorial 01 / EVENT (yellow) -->
  <EditorialStripe
    number="01" label="THE EVENT"
    heading="Two days. One library. Hundreds of games in motion."
    body="Show up Saturday, leave Sunday with three new friends and a list of games you want to buy. Demos, tournaments, open play — all day, both days."
    ctaText="See the schedule →" ctaHref="/schedule"
    bgColor="#FFD166" photo={stripeEvent} photoAlt="REPLAY event floor" photoSide="left"
  />

  <!-- 5. Editorial 02 / 200+ GAMES (blue) -->
  <EditorialStripe
    number="02" label="200+ GAMES"
    heading="From 10-minute fillers to 4-hour epics."
    body="Bring your favorite. Borrow ours. Try something you've never heard of. Publishers and designers are on the floor doing demos all weekend."
    ctaText="What to expect →" ctaHref="/schedule"
    bgColor="#4ECDC4" photo={stripeGames} photoAlt="Games at REPLAY" photoSide="right"
  />

  <!-- 6. Editorial 03 / COMMUNITY (purple) -->
  <EditorialStripe
    number="03" label="COMMUNITY"
    heading="Bangalore's board game crowd, all in one room."
    body="3.5k+ players in the WhatsApp. A few hundred at every REPLAY. New faces every edition. No prior experience needed — pick a game, find a table, ask the room."
    ctaText="Join the WhatsApp →" ctaHref="https://chat.whatsapp.com/GL1h4jipksfCW4vm7OtZjp" ctaExternal
    bgColor="#C3A6FF" photo={stripeCommunity} photoAlt="REPLAY community" photoSide="left"
  />

  <!-- 7. Dark band — Guild Path teaser -->
  <DarkBand
    eyebrow="▸ FOR REGULARS"
    eyebrowColor="var(--color-yellow)"
    heading="Guild Path members get in free (or close to it)."
    body="If you're on the BGC Guild Path, your tier carries to REPLAY. Adventurers get up to ₹1,000 off. Guildmasters: free pass."
    cta={{ text: 'About Guild Path →', href: 'https://boardgamecompany.in/guild-path', external: true, variant: 'primary' }}
  />

  <!-- 8. Sponsors band (hidden when empty) -->
  <SponsorsBand sponsors={sponsors} />

  <!-- 9. Orange CTA finish -->
  {edition && (
    <section style="background: var(--color-orange); position: relative; overflow: hidden; border-top: 4px solid var(--color-ink);">
      <Image src={closingPhoto} alt="" aria-hidden="true" widths={[800, 1600]} sizes="100vw" loading="lazy" class="closing-cta-bg" />
      <div class="container-x px-6 py-16 md:py-24 relative" style="z-index: 1;">
        <h2 class="font-bold text-white" style="font-family: var(--font-heading); font-size: clamp(2.5rem, 7vw, 5rem); line-height: 1.0; letter-spacing: -2px;">
          See you in September.
        </h2>
        <p class="mt-4 text-base md:text-lg max-w-xl" style="color: rgba(255,255,255,0.85);">
          {edition.name} · {edition.start_date} &ndash; {edition.end_date}{edition.venue !== 'TBD' ? ` · ${edition.venue}` : ''}
        </p>
        <div class="mt-8 flex flex-wrap gap-4">
          <a href="/register" class="btn btn-black">Register →</a>
        </div>
      </div>
      <style>
        .closing-cta-bg {
          position: absolute; inset: 0; width: 100%; height: 100%;
          object-fit: cover; opacity: 0.18; filter: contrast(1.05);
        }
      </style>
    </section>
  )}
</Layout>
```

- [ ] **Step 1: Invoke frontend-design skill for the composition polish**

Pass the spec context + the structural template above to the skill. The skill may adjust spacing, micro-typography, or eyebrow glyph rendering. Save the result to `src/pages/index.astro`.

- [ ] **Step 2: Build + test**

```bash
npm run build 2>&1 | tail -5 && npm test 2>&1 | tail -3
```

Expected: build succeeds (4 pages: 404, index, register, schedule); 24/24 tests pass.

- [ ] **Step 3: Local preview**

```bash
npm run dev &
```

Open `http://localhost:4321/`. Walk through all 9 sections. Confirm:
- Dark hero renders, CTA buttons visible
- 3-photo band edge-to-edge
- Edition meta band with LiveSpotsBadge pill
- 3 editorial stripes in yellow/blue/purple, alternating photo sides
- Dark Guild Path band with yellow eyebrow
- Sponsors band absent (none seeded)
- Orange closing CTA with photo backdrop

Kill the dev server: `kill %1` or Ctrl-C.

- [ ] **Step 4: Commit**

```bash
git add src/pages/index.astro
git commit -m "Phase 1E Task 6: Landing page rebuild (9 sections, bgc-arc)

Compose DarkBand + HeroPhotoBand + EditorialStripe (3x) + SponsorsBand
+ inline orange CTA finish. Three editorial stripes alternate
photo sides; Guild Path teaser uses yellow eyebrow. Built via
frontend-design skill.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 7: Rebuild register + schedule pages

**Files:**
- Modify (full rewrite): `src/pages/register.astro`
- Modify (full rewrite): `src/pages/schedule.astro`
- Modify (full rewrite): `src/components/ScheduleDay.astro`

> **Invoke** `Skill(skill='frontend-design:frontend-design', ...)` once for the schedule timeline (visual-heavy). Register page is simpler structural work; can be done directly.

### Register page

Replace `src/pages/register.astro`:

```astro
---
import Layout from '../layouts/Layout.astro';
import RegisterForm from '../components/RegisterForm';
import NotifyMeForm from '../components/NotifyMeForm';
import { getCurrentEdition } from '../lib/data';

const edition = await getCurrentEdition();
const upiId = import.meta.env.PUBLIC_UPI_ID ?? '';
const title = edition ? `Register — ${edition.name}` : 'Register — REPLAY';

const heading = edition
  ? (edition.registration_status === 'open' ? `Get your ${edition.name} pass.` : `${edition.name} — registration opens soon`)
  : 'REPLAY registration';
const sub = edition
  ? (edition.registration_status === 'open' ? `Fill in your details — we'll confirm your spot.` : `Drop your number and we'll email you when registration opens.`)
  : 'No upcoming REPLAY right now.';
---
<Layout title={title}>
  <!-- Header band -->
  <section style="background: var(--color-cream); border-bottom: 4px solid var(--color-ink);">
    <div class="container-x px-6 py-14 md:py-20 text-center">
      <span class="section-tag">Register</span>
      <h1 class="font-bold mt-2" style="font-family: var(--font-heading); font-size: clamp(2.4rem, 5vw, 3.8rem); letter-spacing: -1px;">
        {heading}
      </h1>
      <p class="text-lg mt-3 max-w-xl mx-auto" style="color: rgba(26,26,26,0.7);">
        {sub}
      </p>
    </div>
  </section>

  <!-- Form card -->
  <section class="pb-20" style="background: var(--color-cream);">
    <div class="px-6 pt-12">
      <div class="mx-auto overflow-hidden rounded-2xl" style="max-width: 720px; background: var(--color-paper); border: 4px solid var(--color-ink); box-shadow: 8px 8px 0 var(--color-ink);">
        <div style="height: 12px; background: var(--color-orange); border-bottom: 3px solid var(--color-ink);"></div>
        <div class="p-6 md:p-10">
          {!edition ? (
            <p class="text-center" style="color: rgba(26,26,26,0.6);">No upcoming REPLAY right now.</p>
          ) : edition.registration_status === 'open' ? (
            <RegisterForm client:load edition={edition} upiId={upiId} />
          ) : (
            <NotifyMeForm client:load editionId={edition.id} editionName={edition.name} status={edition.registration_status} />
          )}
        </div>
      </div>
    </div>
  </section>
</Layout>
```

### ScheduleDay component (timeline pattern)

Replace `src/components/ScheduleDay.astro`:

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
  workshop:    'pill-blue',
  tournament:  'pill-pink',
  'open-play': 'pill-yellow',
  meal:        'pill-green',
  talk:        'pill-purple',
};
const KIND_DOT: Record<ScheduleItemRow['kind'], string> = {
  workshop:    'var(--color-blue)',
  tournament:  'var(--color-pink)',
  'open-play': 'var(--color-yellow)',
  meal:        'var(--color-green)',
  talk:        'var(--color-purple)',
};
---
<section class="schedule-day mb-16">
  <div class="flex items-baseline justify-between border-b-4 border-[var(--color-ink)] pb-3 mb-8">
    <h2 class="text-3xl md:text-4xl">{label}</h2>
    <span class="text-sm uppercase tracking-widest text-gray-600">{date}</span>
  </div>
  {items.length === 0 ? (
    <p class="text-gray-500">No items yet.</p>
  ) : (
    <ol class="schedule-timeline">
      {items.map((i) => (
        <li class="schedule-item">
          <span class="schedule-dot" style={`background: ${KIND_DOT[i.kind]};`} aria-hidden="true"></span>
          <div class="schedule-time font-mono text-sm font-bold">
            {i.start_time.slice(0,5)}<br/><span class="text-gray-500">{i.end_time.slice(0,5)}</span>
          </div>
          <div class="schedule-body">
            <div class="font-bold text-lg">{i.title}</div>
            {i.location && <div class="text-sm text-gray-600">{i.location}</div>}
            {i.description && <p class="text-sm mt-1" style="color: rgba(26,26,26,0.75);">{i.description}</p>}
          </div>
          <div class="schedule-kind">
            <span class={`pill ${KIND_PILL[i.kind]}`}>{i.kind}</span>
          </div>
        </li>
      ))}
    </ol>
  )}
</section>

<style>
  .schedule-timeline {
    list-style: none;
    margin: 0; padding: 0;
    position: relative;
  }
  .schedule-timeline::before {
    content: '';
    position: absolute;
    left: 6px; top: 8px; bottom: 8px;
    width: 2px;
    background: rgba(26, 26, 26, 0.25);
  }
  .schedule-item {
    display: grid;
    grid-template-columns: 32px 80px 1fr auto;
    gap: 16px;
    align-items: start;
    padding: 16px 0;
    border-bottom: 1px solid rgba(26, 26, 26, 0.08);
  }
  .schedule-item:last-child { border-bottom: 0; }
  .schedule-dot {
    width: 14px; height: 14px;
    border-radius: 50%;
    border: 2px solid #1A1A1A;
    margin-top: 4px;
    z-index: 1;
  }
  @media (max-width: 640px) {
    .schedule-item {
      grid-template-columns: 24px 1fr;
      grid-template-rows: auto auto auto;
    }
    .schedule-time { grid-column: 2; grid-row: 1; }
    .schedule-body { grid-column: 2; grid-row: 2; }
    .schedule-kind { grid-column: 2; grid-row: 3; padding-top: 4px; }
    .schedule-dot { grid-row: 1 / 4; margin-top: 6px; }
  }
</style>
```

### Schedule page

Replace `src/pages/schedule.astro`:

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
<Layout title={title}>
  <section style="background: var(--color-cream); border-bottom: 4px solid var(--color-ink);">
    <div class="container-x px-6 py-14 md:py-20 text-center">
      <span class="section-tag">Schedule</span>
      <h1 class="font-bold mt-2" style="font-family: var(--font-heading); font-size: clamp(2.4rem, 5vw, 3.8rem); letter-spacing: -1px;">
        When + where
      </h1>
      {edition ? (
        <p class="text-lg mt-3" style="color: rgba(26,26,26,0.7);">
          <strong>{edition.name}</strong> · {edition.start_date} &ndash; {edition.end_date} · {edition.venue}
        </p>
      ) : (
        <p class="text-lg mt-3" style="color: rgba(26,26,26,0.7);">No upcoming edition right now.</p>
      )}
    </div>
  </section>

  <section class="py-16" style="background: var(--color-cream);">
    <div class="px-6" style="max-width: 920px; margin: 0 auto;">
      {edition && items.length === 0 ? (
        <div class="card-brutal card-brutal-lg p-12 text-center max-w-2xl mx-auto">
          <h2 class="text-3xl mb-2">Schedule coming soon</h2>
          <p style="color: rgba(26,26,26,0.6);">Items appear here once the convention's agenda is locked in.</p>
        </div>
      ) : edition && (
        <>
          <ScheduleDay date={edition.start_date} label="Saturday" items={day1Items} />
          <ScheduleDay date={edition.end_date} label="Sunday" items={day2Items} />
        </>
      )}
    </div>
  </section>
</Layout>
```

- [ ] **Step 1: Apply register page rewrite**

Write the file above. No frontend-design skill needed — this is straight composition.

- [ ] **Step 2: Invoke frontend-design skill for the schedule timeline**

Pass the ScheduleDay constraints + the reference structure. The skill may refine the timeline aesthetic (dot styling, line thickness, mobile reflow). Save to `src/components/ScheduleDay.astro`.

- [ ] **Step 3: Apply schedule page rewrite**

Write the file above. No skill needed.

- [ ] **Step 4: Build + test**

```bash
npm run build 2>&1 | tail -5 && npm test 2>&1 | tail -3
```

Expected: build succeeds (4 pages); 24/24 tests pass. RegisterForm + NotifyMeForm tests in particular shouldn't break — their internals are untouched, only the page wrapper changed.

- [ ] **Step 5: Local preview**

```bash
npm run dev &
```

Visit:
- `http://localhost:4321/register` — cream header band, orange-stripe brutal card around the form. NotifyMeForm renders inside (status=upcoming).
- `http://localhost:4321/schedule` — cream header band, "Schedule coming soon" card centered.

To preview the schedule timeline with real items, temporarily insert a few test items via Supabase (or skip — we'll see it when real items are seeded).

Kill dev: `kill %1`.

- [ ] **Step 6: Commit**

```bash
git add src/pages/register.astro src/pages/schedule.astro src/components/ScheduleDay.astro
git commit -m "Phase 1E Task 7: Register + schedule page redesigns

Both pages get a cream header band with section-tag + big h1. Register
form lives inside a 720px brutal card with an orange top stripe.
Schedule items render as a timeline with kind-colored dots + pills
(workshop=blue, tournament=pink, open-play=yellow, meal=green,
talk=purple). Schedule timeline built via frontend-design skill.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 8: Sub-component palette consistency sweep

**Files:**
- Modify: `src/components/NotifyMeForm.tsx`
- Modify: `src/components/RegisterForm.tsx`
- (Verify only): `SuccessScreen.tsx`, `UpiBottomSheet.tsx`, `LiveSpotsBadge.tsx`

Goal: replace any orphan `teal`/`violet` references introduced in 1C with the new bgc palette.

- [ ] **Step 1: Grep for orphan palette references**

Run:
```bash
grep -rE "(color-teal|color-violet|pill-teal|pill-violet|--color-orange-light)" src/ 2>&1 | head -10
```

Note every file that surfaces. These are the spots to update.

- [ ] **Step 2: Update `src/components/RegisterForm.tsx`**

Find the discount_blocked anti-split callout (uses `border-[var(--color-violet)]`):

```tsx
<div className="card-flat p-4 mb-4 border-[var(--color-violet)]" style={{ background: '#FFF6E0' }}>
```

Change `--color-violet` → `--color-pink`:

```tsx
<div className="card-flat p-4 mb-4 border-[var(--color-pink)]" style={{ background: '#FFF6E0' }}>
```

Find the guild tier preview callout (uses `--color-teal`):

```tsx
<div className="card-flat p-4 mb-4" style={{ background: '#E8F5F2', borderColor: 'var(--color-teal)' }}>
```

Change `--color-teal` → `--color-green`:

```tsx
<div className="card-flat p-4 mb-4" style={{ background: '#E8F5F2', borderColor: 'var(--color-green)' }}>
```

Also: the "Welcome back, {name}" pill in RegisterForm:

```tsx
<p className="mb-4"><span className="pill pill-teal">Welcome back, {lookup.user.name}</span></p>
```

Change to `pill-green`:

```tsx
<p className="mb-4"><span className="pill pill-green">Welcome back, {lookup.user.name}</span></p>
```

Also check the "discount preview" callout for any teal/violet:

```tsx
{discount > 0 && (
  <div className="flex justify-between text-sm text-[var(--color-teal)] font-bold"><span>Discount</span><span>−₹{discount}</span></div>
)}
```

Change to:

```tsx
{discount > 0 && (
  <div className="flex justify-between text-sm text-[var(--color-orange-dark)] font-bold"><span>Discount</span><span>−₹{discount}</span></div>
)}
```

- [ ] **Step 3: Verify other islands have no orphans**

`NotifyMeForm.tsx` uses `pill-yellow` and `--color-error` — both still valid. No changes expected, just confirm via grep.

`SuccessScreen.tsx`, `UpiBottomSheet.tsx`, `LiveSpotsBadge.tsx` — should be palette-neutral (orange + ink only). Confirm via grep.

- [ ] **Step 4: Re-run grep to confirm no orphans remain**

```bash
grep -rE "(color-teal|color-violet|pill-teal|pill-violet|--color-orange-light)" src/ 2>&1 | head
```

Expected: no matches (or only matches in docs/, not runtime files).

- [ ] **Step 5: Run tests**

```bash
npm test 2>&1 | tail -5
```

Expected: 24/24 pass.

- [ ] **Step 6: Commit**

```bash
git add src/components/RegisterForm.tsx
git commit -m "Phase 1E Task 8: Palette consistency sweep on islands

Replace orphan teal/violet refs from 1C with bgc-palette equivalents.
RegisterForm: guild tier preview = green border, anti-split warning =
pink border, welcome-back pill = pill-green, discount line = orange-
dark text. NotifyMeForm + SuccessScreen + UpiBottomSheet + LiveSpots
Badge already palette-clean (no changes).

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 9: Build + final local smoke + commit cleanup

**Files:** none modified.

- [ ] **Step 1: Full build**

```bash
npm run build 2>&1 | tail -10
```

Expected: 4 pages built (`/`, `/register`, `/schedule`, `/404`), no errors, image optimization runs.

- [ ] **Step 2: Full test suite**

```bash
npm test 2>&1 | tail -10
cd worker && npm test 2>&1 | tail -5 && cd ..
```

Expected: site 24/24, worker 66/66.

- [ ] **Step 3: Local preview walkthrough**

```bash
npm run dev &
```

Visit `http://localhost:4321/`:
1. Dark hero with 2 CTAs ✓
2. 3-photo band edge-to-edge ✓
3. Cream edition meta band + LiveSpotsBadge pill ✓
4. Editorial 01/EVENT (yellow, photo left) ✓
5. Editorial 02/200+ GAMES (blue, photo right) ✓
6. Editorial 03/COMMUNITY (purple, photo left) ✓
7. Dark Guild Path band with yellow eyebrow ✓
8. Sponsors band (absent — none seeded) ✓
9. Orange closing CTA with photo backdrop ✓

Visit `/register`:
- Cream header + section-tag ✓
- Form in orange-stripe brutal card ✓
- NotifyMeForm renders inside ✓

Visit `/schedule`:
- Cream header ✓
- "Schedule coming soon" card centered ✓

Kill dev: `kill %1`.

- [ ] **Step 4: Push the branch**

```bash
git push -u origin redesign/phase-1e
```

---

## Task 10: PR + merge

**Files:** none modified.

- [ ] **Step 1: Open PR**

```bash
gh pr create --base main --head redesign/phase-1e \
  --title "Phase 1E: Visual redesign aligned with bgc-website" \
  --body "$(cat <<'EOF'
## Summary

Full visual redesign of the 3 site pages to match bgc-website's design language. Palette swap (orange + pink + blue + green + purple + yellow on cream #FFF8E7), 4 new shared components, 9-section landing arc, register page with orange-stripe brutal card, schedule timeline.

## What changed

- `src/styles/global.css` — palette tokens swap (drop teal+violet), new `.section-tag`, `.btn-outline-white`, pink/blue/green/purple pill variants
- 4 new Astro components: `HeroPhotoBand`, `EditorialStripe`, `DarkBand`, `SponsorsBand`
- Landing page: 9 sections composing the bgc-arc
- Register page: cream header + orange-stripe brutal card
- Schedule page: cream header + timeline-style `<ScheduleDay>` with kind-colored dots
- 7 photos moved from `public/carousel-photos/` → `src/assets/landing/` (renamed semantically; optimized via Astro Image)
- Palette sweep on existing islands (RegisterForm)

## Tests

- Worker: 66/66 still green (no worker changes)
- Site: 24/24 still green (test assertions are semantic)
- No new tests added (visual layer)

## Preview

Cloudflare Pages preview URL on this PR shows the redesign at the *.pages.dev domain.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

Expected: PR URL printed.

- [ ] **Step 2: Watch CI**

```bash
gh pr checks --watch
```

Wait for ✓ on both Pages checks (replay-website + replay-admin).

- [ ] **Step 3: Visual sanity check on preview URL**

Open the preview URL from the Cloudflare Pages check. Walk through all 3 pages. If anything looks off, fix on the branch (more commits) and re-check.

- [ ] **Step 4: Merge**

```bash
gh pr merge --squash --delete-branch
```

CF Pages auto-deploys `main` → live apex.

- [ ] **Step 5: Wait + verify live apex**

```javascript
// via ctx_execute
async function check() {
  const res = await fetch('https://replaycon.in/');
  const html = await res.text();
  return {
    status: res.status,
    section_tag: html.includes('section-tag'),
    editorial: html.includes('THE EVENT') || html.includes('200+ GAMES'),
    closing: html.includes('See you in September'),
  };
}
for (let i = 0; i < 8; i++) {
  const r = await check();
  console.log(`attempt ${i+1}:`, r);
  if (r.section_tag && r.editorial && r.closing) break;
  await new Promise(r => setTimeout(r, 15000));
}
```

Expected: all three markers true within 60-90s.

---

## Task 11: CLAUDE.md update

**Files:**
- Modify: `CLAUDE.md` (append Session learnings)

- [ ] **Step 1: Append entries to bottom of `CLAUDE.md`**

```markdown
- 2026-05-22 — Phase 1E shipped: full visual redesign aligned with bgc-website. Palette swap to bgc's (orange+pink+blue+green+purple+yellow on cream #FFF8E7). 4 new shared components (HeroPhotoBand, EditorialStripe, DarkBand, SponsorsBand). Landing rebuilt as bgc's 9-section arc. Register page uses orange-stripe brutal card. Schedule uses timeline pattern. Used the frontend-design skill (frontend-design:frontend-design) during execution for component + page polish. **Why it matters:** any future page should compose from these 4 shared components, not roll its own brutal layouts. If you find yourself inlining "dark slab with heading", reach for <DarkBand> first.
- 2026-05-22 — Photos live in `src/assets/landing/*.jpeg` (NOT `public/`) so Astro's Image component can optimize them with widths + sizes. Filenames are semantic (hero-band-1, stripe-event, etc.) — they map to specific landing slots. **Why it matters:** when you replace a photo, drop the new one with the same filename, no code changes needed. When you ADD a slot, the photo lives in src/assets/landing/ and gets imported in the page.
- 2026-05-22 — Schedule kind → pill color map (Phase 1E): workshop=blue, tournament=pink, open-play=yellow, meal=green, talk=purple. Map lives in ScheduleDay.astro alongside a parallel KIND_DOT map for the timeline bullets. **Why it matters:** adding a new schedule_items.kind value requires updating both the DB check constraint AND both maps.
```

- [ ] **Step 2: Commit + push to main**

```bash
git checkout main
git pull
# (Add the entries to CLAUDE.md, then:)
git add CLAUDE.md
git commit -m "Document Phase 1E redesign learnings

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
git push
```

---

## Definition of Done

- [ ] All 11 tasks complete.
- [ ] PR `redesign/phase-1e` → `main` merged.
- [ ] Live apex `https://replaycon.in/` serves the redesigned landing, register, schedule.
- [ ] 24/24 site tests + 66/66 worker tests green throughout.
- [ ] `https://api.replaycon.in/api/health` still 200 (worker untouched).
- [ ] `https://admin.replaycon.in/` still CF-Access-gated (admin untouched).
- [ ] CLAUDE.md updated.
- [ ] No orphan teal/violet references in `src/`.

After this plan: REPLAY's website reads as a literal sibling of bgc-website. Email template visual rework (Phase 1F) is the next visual-layer phase whenever you want it.
