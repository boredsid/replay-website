# REPLAY Phase 1C — Design overhaul

**Date:** 2026-05-22
**Status:** Approved (brainstorm complete; implementation plan pending)
**Parent:** `docs/superpowers/specs/2026-05-18-replay-rebuild-design.md`
**Predecessors:** Phase 1A (worker), Phase 1B (site pages)
**Branch:** `rebuild/phase-0`

## Goal

Restyle the three Phase 1B site pages + email template with the neo-brutalist design system shared with `bgc-website`, using a REPLAY-distinct palette (orange anchor, teal/yellow/violet accents) and Space Grotesk + Inter typography. Visual is locked at end of 1C so 1D (cutover) can ship to apex without surprises.

## Non-goals

- Playwright E2E coverage (1D)
- New pages or features (`/preorder`, `/editions/[slug]` — out of scope)
- Animations beyond the brutalist hover-translate pattern
- Code of conduct / FAQ / press-kit content
- Admin tool styling (Phase 3 ships its own bgc-shadcn shell)

## Scope

**In:**
- `src/styles/global.css` becomes the single source for design tokens + brutalist utility classes. Replaces Phase 0's 5-var placeholder.
- Google Fonts `<link>` for Space Grotesk + Inter loaded in `Layout.astro`.
- `.btn` family (`btn-primary`, `btn-secondary`, `btn-black`, `btn-nav`, `btn-sm`), `.card-brutal`, `.pill`, `.input-brutal` utility classes — port from bgc with replay palette swap.
- `Layout.astro` shell restyle: sticky header with REPLAY wordmark + nav buttons; 3-column footer with Instagram icon link + mailto + copyright.
- `HeroSection.astro` switches to split layout (text left, single photo right). Hero photo path in `landing/hero.mdx` frontmatter (`photo` field added).
- `AboutSection.astro`, `SponsorsSection.astro`, `RegisterCTA.astro` restyled to new tokens.
- `ScheduleDay.astro` items render as `.card-brutal` rows with kind-colored pills (workshop→teal, tournament→orange, open-play→yellow, meal→cream-dark, talk→violet).
- `RegisterForm.tsx` restyle: fields in cards, pass-type radios become big buttons, day pills, discount preview as colored callout, UPI sheet keeps brutalist border+shadow during animation.
- `NotifyMeForm.tsx`, `LiveSpotsBadge.tsx`, `UpiBottomSheet.tsx`, `SuccessScreen.tsx` all restyled.
- `src/emails/registration.html` light polish: system font stack, hard shadow on card, pass-type + day pills.
- `landing/hero.mdx` schema gains optional `photo` field.

**Out:**
| Item | Target |
|---|---|
| Playwright E2E coverage | 1D |
| `/preorder` page + endpoint + products | 1B-extra |
| `/editions/[slug]` archive page | Phase 2 |
| Apex DNS cutover + bgc PR merge + status='open' flip | 1D |
| Mobile-specific motion / animations | post-launch |
| Code of conduct, FAQ, past-editions footer links | post-launch |

## Design tokens

`src/styles/global.css`:

```css
@import "tailwindcss";

@theme {
  /* REPLAY palette — orange anchor + teal/yellow/violet accents */
  --color-orange: #F47B20;
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
  letter-spacing: -0.02em;
  line-height: 1.1;
}
```

## Component utility classes

Direct port from `bgc-website/src/styles/global.css` with palette swap. Replay's `.btn-secondary:hover` uses `--color-teal` (not bgc's pink). All others identical primitives.

- `.btn` — base flex+gap+border+radius+transition with hover translate(-2px,-2px) + bigger shadow
- `.btn-primary` — orange bg, white text
- `.btn-secondary` — white bg, ink text, teal on hover
- `.btn-black` — ink bg, white text
- `.btn-nav` — smaller pill used in header nav
- `.btn-sm` — compact variant
- `.card-brutal`, `.card-brutal-lg` — bordered card with shadow + hover translate
- `.pill` — small bordered chip with tier-based bg color (set via inline style or modifier)
- `.input-brutal` — form field with brutalist border, focus state thickens shadow

(See bgc's global.css for the literal definitions; replay reuses them verbatim except colors.)

## Layout shell

```
Header (sticky, --border-thick bottom, paper bg)
├─ .replay-wordmark — orange Space Grotesk extrabold "REPLAY"
└─ nav:
   ├─ a.btn-nav → /schedule
   └─ a.btn-nav → /register

<main>

Footer (--border-thick top, paper bg)
├─ left:  a "hello@boardgamecompany.in" (mailto)
├─ center: Instagram icon link → https://www.instagram.com/replay.convention
└─ right: "© REPLAY · Bangalore"
```

Mobile: header collapses to wordmark + hamburger (animated to slide-down). Footer stacks vertically.

## Landing — Hero (split layout)

`HeroSection.astro` becomes a 2-column grid (`grid-cols-1 md:grid-cols-[1.2fr_1fr]`):

```
LEFT:
  [eyebrow — orange, uppercase, letter-spaced]
  [Title — Space Grotesk 48-56px, ink, tight tracking]
  [Subtitle — Inter 16-18px, slate-700]
  [Edition meta — small text, "REPLAY 3 · Sep 12-13 · TBD"]
  [.btn .btn-primary "Get notified" or "Register now"]
  [<LiveSpotsBadge> below CTA]
  [MDX body content as prose]

RIGHT:
  <img> in .card-brutal wrapper, aspect-[4/5], object-cover
  src from frontmatter `photo` (default fallback: /carousel-photos/3.jpeg)
```

Hero MDX schema gains:

```ts
const landing = defineCollection({
  loader: glob({ pattern: '**/*.mdx', base: './src/content/landing' }),
  schema: z.object({
    eyebrow: z.string().optional(),
    title: z.string().optional(),
    subtitle: z.string().optional(),
    photo: z.string().optional(), // path under /public e.g. "/carousel-photos/3.jpeg"
  }),
});
```

Initial value in `hero.mdx`: `photo: "/carousel-photos/3.jpeg"` (user picks favorite; can swap later).

Mobile: photo moves below text. Photo stays bordered+shadowed.

## Landing — Other sections

**About:** single column, `.prose` body. Heading uses Space Grotesk.

**Sponsors:** kept hidden when empty. When present:
- One section per tier (title / gold / silver / partner).
- Tier label = `.label` (small uppercase).
- Logos in `.card-brutal` containers, fixed height 80px, object-contain.
- Title tier gets `.card-brutal-lg` and centered solo.

**Register CTA:** `.btn-primary` (or `.btn-black` if sold_out). `<LiveSpotsBadge>` renders below in a `.pill` showing `Day 1: 248 · Day 2: 245`.

## Register page (`/register`)

`<RegisterForm>` restyle:
- Wrapping card `.card-brutal` around the whole form on desktop; mobile is edge-to-edge.
- Each input wrapped in `.input-brutal` style.
- Pass-type selector becomes 2 big buttons side-by-side (selected = `.btn-primary`, unselected = `.btn-secondary`).
- Day selector: 2 pill buttons (Saturday / Sunday). Disabled (sold-out) days get `opacity-50 line-through`.
- Live discount preview: dedicated callout below the form fields, bordered cream-dark bg with orange accent line:
  ```
  ┌────────────────────────────┐
  │ Base    ₹800               │
  │ Discount −₹800 (Guildmaster) │
  ├────────────────────────────┤
  │ You pay  ₹0                │
  └────────────────────────────┘
  ```
- "Welcome back, X" banner becomes a `.pill` with teal accent.
- Anti-split warning: yellow background callout with violet border (high-attention but not error-red).
- Submit button: full-width `.btn .btn-primary`.

UPI bottom sheet: keeps brutalist treatment — `border-thick` + `shadow-lg`, slides up from bottom with 250ms ease-out. QR image bordered with `.card-brutal`. "I've paid" button = `.btn-primary` full-width.

Success screen: centered card with bold heading, ink body. "Back to home" as `.btn-secondary`.

## Schedule page (`/schedule`)

Header section: edition info in a cream-dark band.

Each day = section with heading "Saturday · Sep 12" (uses `dayLabel` map).

Items render as horizontal-flex rows (`.card-brutal`):

```
┌──────────────────────────────────────────────┐
│ 10:00–11:30   ┃   Demo: Wingspan             │
│               ┃   Hall A                     │
│               ┃   Beginner-friendly demo.    │
│                                  [workshop]  │ ← pill bottom-right
└──────────────────────────────────────────────┘
```

Kind → pill background color map:
```ts
const KIND_COLORS = {
  workshop:   'var(--color-teal)',
  tournament: 'var(--color-orange)',
  'open-play':'var(--color-yellow)',
  meal:       'var(--color-cream-dark)',
  talk:       'var(--color-violet)',
};
```

Empty state: large `.card-brutal-lg` centered with "Schedule coming soon." + small "Items appear here once the convention's agenda is locked in."

## Email template

`src/emails/registration.html` light polish:

1. Replace `font-family` strings with system stack: `-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif`.
2. Add `box-shadow: 6px 6px 0 #1A1A1A` to the white inner card (most modern email clients support box-shadow; older ones gracefully ignore).
3. Two pills inserted under the heading row inside the orange header strip:
   ```html
   <span style="display:inline-block;background:#FFD166;color:#1A1A1A;padding:4px 10px;border-radius:999px;border:2px solid #1A1A1A;font-size:12px;font-weight:700;margin-right:6px;">{{pass_type}}</span>
   <span style="display:inline-block;background:#FFFFFF;color:#1A1A1A;padding:4px 10px;border-radius:999px;border:2px solid #1A1A1A;font-size:12px;font-weight:700;">{{days_label}}</span>
   ```

Everything else stays the same — variables, structure, mailto footer.

## Testing

All Phase 1A worker tests (66) and Phase 1B site tests (24) must stay green. Restyle is CSS + markup changes; test assertions in RegisterForm.test.tsx etc. should be checking semantic markers (role, label text, etc.), not class names — so they should survive without changes.

If any test breaks because of moved DOM (e.g. role change), update the test to match the new DOM rather than reverting the style. Capture the change in the commit message.

No new tests added in 1C — visual changes are verified by manual smoke on `replay-website.pages.dev`.

## Deploy + smoke

Push triggers Cloudflare Pages rebuild. Manual smoke:
1. Landing loads with Space Grotesk + Inter (check DevTools → Network → Fonts).
2. Hero photo renders to the right of text on desktop, below on mobile.
3. Sponsor section absent (none seeded yet).
4. Register CTA button uses orange brutal style, hover lifts the shadow.
5. `/schedule` shows the empty card.
6. `/register` shows the styled NotifyMeForm (status=upcoming) with the brutal input + button.
7. Test a status=open flip + a synthetic registration to view the styled form + UPI sheet flow end-to-end. Cleanup after.
8. Send a synthetic test email (via the worker → GAS pathway exercised at end of 1A) to verify the email template renders the pills.

## Definition of Done

- [ ] `npm run build` succeeds.
- [ ] `npm test` at root: still 24/24 green (or updated assertions, with reason in commit).
- [ ] `cd worker && npm test`: still 66/66 green.
- [ ] Hero photo lives at `/carousel-photos/3.jpeg` (or another, user's choice) and renders right-side on desktop.
- [ ] Header sticky + Instagram link in footer.
- [ ] Schedule kind pills colored per the map.
- [ ] Email template loads with system fonts + has pass-type + day pills.
- [ ] Smoke walkthrough on `replay-website.pages.dev` passes.
- [ ] All commits pushed to `origin/rebuild/phase-0`.
- [ ] CLAUDE.md updated with Phase 1C learnings.

## Open questions for implementation

- bgc's `global.css` has additional utility classes (e.g. `.section`, `.container-x`) that may or may not be needed in replay. Port only what's used; don't blind-copy the whole file.
- Sticky header may need a backdrop-blur or solid cream bg when content scrolls under. Default: solid cream-dark bg with `--border-thick` bottom — no blur. If readability suffers in testing, add `backdrop-filter`.
- `--color-cream-dark` is currently `#F0E6D8` (a brownish off-cream). Used for `meal` pills, borders elsewhere. If it reads muddy next to white cards, switch to a slate tone like `#E5E1D8`.
- Hero photo aspect ratio is 4:5 in the spec. If the chosen photo is landscape, we'll need to either crop (CSS `object-cover`) or relax to a 3:4 ratio. Default to `object-cover` first.
