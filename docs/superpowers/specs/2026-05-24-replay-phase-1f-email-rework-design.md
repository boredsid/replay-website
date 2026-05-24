# Phase 1F — Registration email rework

**Date:** 2026-05-24
**Branch target:** new feature branch off `main`
**Author session:** brainstorming round 2026-05-24
**Status:** spec — awaiting plan + implementation

## Goal

Bring the registration confirmation email up to the bgc-aligned 1E visual identity that now defines the site, add four content blocks attendees actually want (what to expect / add to calendar / schedule + venue / share + social), and fix a pre-existing display bug where `{{edition_name}}` rendered as just `"REPLAY"` (making the subject line read `"REPLAY REPLAY — registration confirmed"`).

Not in scope: preorder email template, schedule-data injection (the email links to `/schedule`, doesn't embed items), conditional template rendering, migration off dumb string substitution.

## Background

Phase 1E (commit `f31823b`) shipped the bgc-aligned visual identity across the site — cream `#FFF8E7` base, 4px ink borders, hard-edge shadows, palette of orange + pink + blue + green + purple + yellow + indigo `#1A0088` for dark slabs. The email template (`src/emails/registration.html`) was left at 1C's lighter polish: white card on `#FFF8F0`, 3px borders, single accent (orange + yellow).

The email is fetched by Google Apps Script from raw.githubusercontent.com (main branch) on every send, then dumb-substitutes `{{key}}` against the `variables` object the worker sends. No template engine. No conditionals. GAS has a ~5min fetch cache.

The worker calls `sendEmail()` for the zero-payment registration path (Guild 100%-off cases). Paid flows currently route through a separate confirmation step.

## Visual treatment — single brutalist card

Layout direction: single envelope card holding everything (chosen over stacked-slabs in brainstorming). Page bg cream, card paper white with 4px ink border and 8px hard shadow, header strip orange `#F47B20` (orange is the on-light anchor; indigo `#1A0088` is reserved for dark slabs and we don't have one here).

Four new content blocks live inside the card as colored mini-cards, each with 3px ink border and 8px radius:

| Block | Fill |
|---|---|
| What to expect | `#FFD166` yellow |
| Add to calendar | `#A8E6CF` green |
| Schedule + venue | `#C3A6FF` violet |
| Share + social footer | `#1A1A1A` ink, white text |

Pass-type pill stays yellow + 2px ink border; days pill stays paper + 2px ink border. Details table keeps 3px ink frame with 2px row dividers.

**Content of each new block:**

- *What to expect* (yellow) — eyebrow `WHAT TO EXPECT`, single line: `Open play tables · weekend tournaments · publisher demos · food + chai stall`. Hardcoded copy.
- *Add to calendar* (green) — eyebrow `ADD TO CALENDAR`, two button-styled `<a>` spans side-by-side: `Google Calendar` → `{{calendar_google_url}}`, `Download .ics` → `{{calendar_ics_url}}`. Apple Mail and Outlook download/open the .ics; Gmail mobile previews it.
- *Schedule + venue* (violet) — eyebrow `SCHEDULE + VENUE`, body: `Venue: {{venue}}. We'll mail you again once it's locked in.` followed by underlined link `View full schedule on replaycon.in →` pointing at `{{schedule_url}}`. The "TBD" string is part of the copy when venue isn't set yet (no conditional logic).
- *Share + social footer* (ink, white text) — three inline items separated by `·`: `Bring a friend → WhatsApp` (`{{whatsapp_share_url}}`), `Instagram @replaycon` (`{{instagram_url}}`), `Reply to this email`. Sits flush against card bottom edge; rounded only at bottom corners.

**Email-client constraints baked in:**
- All CSS inline (no `<style>` block; Gmail/Outlook strip them inconsistently)
- Outer structure uses `<table>` for Outlook desktop
- No web fonts — `-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif` everywhere
- No flexbox/grid — `display: inline-block` + tables only
- `border-radius` and `box-shadow` degrade gracefully (Outlook flattens; borders + colors still hold)
- Card width capped at 560px

## Edition display name fix

Today `register.ts` sends `edition_name: edition.name`. The DB `editions.name` is just `"REPLAY"` (see CLAUDE.md learning from 2026-05-22). Result: subject line `REPLAY ${edition.name} — registration confirmed` renders as `"REPLAY REPLAY — registration confirmed"`, and body header reads `"You're in for REPLAY"`.

Fix folded into this phase:

- Port `editionOrdinal(slug)` from `src/lib/data.ts` to new `worker/src/format.ts` (5 LOC, no deps). Returns `"3rd edition"` for `"replay-3"`, falls back to `""` for non-matching slugs.
- `register.ts` builds `editionDisplayName = \`REPLAY ${editionOrdinal(edition.slug)}\`.trim()` (trims so a fallback empty ordinal yields `"REPLAY"`, not `"REPLAY "`).
- `subject` becomes `\`${editionDisplayName} — registration confirmed\`` — no leading `REPLAY ` prefix.
- `variables.edition_name` becomes `editionDisplayName`.

After the change, every `{{edition_name}}` site in the template renders as `"REPLAY 3rd edition"`.

## New worker components

### `worker/src/format.ts` (new)
Pure helpers, no I/O.
- `editionOrdinal(slug: string): string` — ported verbatim from `src/lib/data.ts`.
- Future-friendly home for any other display-string helpers the worker grows.

### `worker/src/calendar.ts` (new)
Pure helpers.
- `buildGoogleCalendarUrl(edition): string` — builds `https://calendar.google.com/calendar/render?action=TEMPLATE&text=...&dates=YYYYMMDDTHHMMSSZ/YYYYMMDDTHHMMSSZ&details=...&location=...`. Date conversion: edition start/end are `YYYY-MM-DD` strings; assume event runs convention hours (start 10:00 IST → 04:30 UTC, end 19:00 IST → 13:30 UTC). Encode `text`, `details`, `location` via `encodeURIComponent`.
- `buildWhatsAppShareUrl(edition): string` — builds `https://wa.me/?text=` with prefilled text mentioning edition name + date range + `replaycon.in` URL.
- Both handle `venue = 'TBD'` gracefully (location field reads "TBD" — better than empty).

### `worker/src/ics.ts` (new)
Single-purpose endpoint handler.
- `handleIcsRequest(req, env): Response`
- Parses `:slug` from URL path `/api/ics/:slug.ics`
- Looks up edition row from Supabase by `slug`
- Returns `text/calendar; charset=utf-8` body containing minimal VCALENDAR + VEVENT:
  - `UID:replay-{slug}@replaycon.in`
  - `DTSTAMP` = now UTC
  - `DTSTART` / `DTEND` = edition dates in UTC (same conversion as Google URL)
  - `SUMMARY:REPLAY {ordinal} edition`
  - `LOCATION:` = `edition.venue || 'TBD'`
  - `DESCRIPTION:` = short blurb + ticket link
  - `URL:` = `https://replaycon.in`
- `Cache-Control: public, max-age=86400` (24h — edition data rarely changes)
- 404 if slug doesn't match a published edition

### `worker/src/index.ts` (edit)
Add route `GET /api/ics/:slug.ics → handleIcsRequest`. Public, no auth.

### `worker/src/register.ts` (edit)
- Import `editionOrdinal` from `./format`, `buildGoogleCalendarUrl` + `buildWhatsAppShareUrl` from `./calendar`
- Compute `editionDisplayName` once
- Pass to `subject` and `variables.edition_name`
- Append to `variables`: `calendar_google_url`, `calendar_ics_url` (=`\`https://api.replaycon.in/api/ics/${edition.slug}.ics\``), `schedule_url` (=`'https://replaycon.in/schedule'`), `instagram_url` (=`'https://instagram.com/replaycon'`), `whatsapp_share_url`

## Template placeholders — full list after this phase

| Placeholder | Source | Example |
|---|---|---|
| `{{name}}` | form | `Siddhant` |
| `{{edition_name}}` | **CHANGED** — `REPLAY {ordinal} edition` | `REPLAY 3rd edition` |
| `{{venue}}` | `edition.venue` | `TBD` |
| `{{start_date}}` | `edition.start_date` | `2026-09-12` |
| `{{end_date}}` | `edition.end_date` | `2026-09-13` |
| `{{pass_type}}` | form | `Campaign` |
| `{{days_label}}` | derived | `Sat + Sun` |
| `{{seats}}` | derived | `1` |
| `{{amount_paid}}` | derived | `0` |
| `{{discount_applied}}` | derived | `2800` |
| `{{guild_tier}}` | derived | `Adventurer` |
| `{{calendar_google_url}}` | **NEW** | `https://calendar.google.com/calendar/render?...` |
| `{{calendar_ics_url}}` | **NEW** | `https://api.replaycon.in/api/ics/replay-3.ics` |
| `{{schedule_url}}` | **NEW** | `https://replaycon.in/schedule` |
| `{{instagram_url}}` | **NEW** | `https://instagram.com/replaycon` |
| `{{whatsapp_share_url}}` | **NEW** | `https://wa.me/?text=Going...` |

No GAS changes needed — the substitution loop iterates over whatever keys `variables` carries.

## Tests

| File | Tests |
|---|---|
| `worker/src/format.test.ts` (new) | 3 — ordinal for `replay-1` / `replay-3` / `replay-21`, fallback for malformed slug |
| `worker/src/calendar.test.ts` (new) | 4 — Google URL has correct UTC dates, URL-encoded venue/title, WhatsApp URL has prefilled text with edition name, helpers handle `venue=TBD` |
| `worker/src/ics.test.ts` (new) | 4 — valid slug returns 200 + `text/calendar` MIME + body contains `BEGIN:VEVENT` + `SUMMARY:REPLAY`, unknown slug returns 404, cache header present, DTSTART/DTEND correct |
| `worker/src/register.test.ts` (edit) | 1 update — zero-payment email payload now asserts new 5 keys present + `edition_name === "REPLAY 3rd edition"` + new subject shape |

Total: 66 existing + ~11 new/changed = ~75 worker tests.

## Manual verification (before commit)

1. `cd worker && npm run dev` — worker on :8787
2. `curl http://localhost:8787/api/ics/replay-3.ics` → paste body into [icalendar.org/validator.html](https://icalendar.org/validator.html), expect zero errors
3. Trigger a 100%-discount zero-payment registration against local worker; verify console log shows full `variables` payload with new keys + correct `edition_name`
4. Substitute placeholders by hand in `src/emails/registration.html` for one variant, open in browser — verify cream bg, brutalist borders, hard shadow, every block readable
5. Send via [putsmail.com](https://putsmail.com) to: Gmail web (`siddhantnarula96@gmail.com`), Apple Mail iOS, Outlook web — screenshot each. Outlook desktop is best-effort; flat-rectangle fallback is acceptable but borders + colors must hold.

## Risks + mitigations

| Risk | Mitigation |
|---|---|
| Email links to `/api/ics/...` 404 if worker deploys after template merge | Deploy worker first, then merge template PR. Sequencing called out in plan. |
| GAS UrlFetchApp 5-min cache serves stale template after first email send post-merge | Acceptable; not a deploy blocker. Auto-resolves. |
| Future "if venue == TBD show X" needs conditional logic | Out of scope. Documented as tech debt; would require swapping dumb substitution for Handlebars in GAS. |
| Outlook desktop flattens shadows/radius | Accepted. Falls back to flat rectangles with intact borders + colors. Manual verification gate catches if borders break. |
| Google Calendar event time wrong if convention hours change | Hours hardcoded (10:00–19:00 IST). Acceptable; convention is fixed-hours. |

## Rollback

1. Revert template PR — emails immediately return to current look on next GAS template fetch (max 5min cache).
2. Worker endpoint stays deployed; harmless (unused once template reverts).
3. To fully revert worker too: `cd worker && git checkout <prev-sha> -- src/ && npx wrangler deploy`.

## File map

```
src/emails/registration.html             rewritten (visual reskin + 4 new blocks + new placeholders)
worker/src/format.ts                     NEW   editionOrdinal helper
worker/src/format.test.ts                NEW   3 tests
worker/src/calendar.ts                   NEW   Google + WhatsApp URL helpers
worker/src/calendar.test.ts              NEW   4 tests
worker/src/ics.ts                        NEW   GET /api/ics/:slug.ics handler
worker/src/ics.test.ts                   NEW   4 tests
worker/src/index.ts                      edit  route registration
worker/src/register.ts                   edit  edition name fix + new payload keys
worker/src/register.test.ts              edit  updated assertions
docs/superpowers/specs/2026-05-24-replay-phase-1f-email-rework-design.md   NEW (this file)
docs/superpowers/plans/2026-05-24-replay-phase-1f-email-rework.md           NEW (next step)
```

## Deploy sequence

1. Land PR on `main` (CF Pages auto-deploys site rebuild — template file goes live on raw.githubusercontent)
2. `cd worker && npx wrangler deploy` — `/api/ics/:slug.ics` goes live
3. Trigger a single test registration to confirm round-trip works end-to-end before broadcasting
4. (Optional) GAS template cache: wait up to 5 min for next email to pick up new template, or send a no-op redeploy to GAS to force refresh

Worker deploy is intentionally manual (not CF Pages-style auto-deploy from main) — same pattern as Phases 1A-1E.
