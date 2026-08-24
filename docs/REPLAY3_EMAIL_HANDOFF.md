# REPLAY 3 email campaign

Current as of 24 Aug 2026. The campaign is built and verified; all that remains
is scheduling the seven drafts.

## Where it stands

Seven drafts sit in the `hello@boardgamecompany.in` mailbox, one per batch, each
with its 41 (or 39) recipients already in BCC. Sid schedules them by hand with
Gmail's Schedule send, one a day. Live state — which batch went out when — lives
in `marketing/replay-3/send-log.md`, not here.

- Subject: `Bengaluru's offline gaming weekend is back...`
- HTML: `src/emails/replay-3-invite.html`
- Recipients: `marketing/replay-3/batches/day-1.txt` … `day-7.txt`, 285 total,
  no duplicates, no overlaps. Order does not matter — together they cover the
  list exactly once, so the only rule is that each draft is sent once.
  **Those files and `bgc-recipients.txt` are gitignored** — they are real
  people's contact details and git history is permanent. They live on disk only.
  If you need them on another machine, regenerate from Supabase with the query at
  the end of this document and re-split into seven chunks.
- WhatsApp broadcast (`marketing/replay-3/whatsapp-notify-leads.md`) has already
  been sent. No further action.

## How it sends

The Gmail MCP connector, authorised as the `hello@boardgamecompany.in` send-as
alias on the consumer account `boardgamecompany2024@gmail.com`. The connector has
no `from` parameter — it sends as whichever account authorised it.

### What the connector does to your HTML

Measured by drafting through the connector and diffing the exported `.eml`
against the source. **An earlier version of this document got this wrong**, said
every background declaration was stripped, and caused a redesign-and-revert. The
actual behaviour:

| Sent | Stored |
| --- | --- |
| `background-color:#E8722C` | **survives** (lowercased) |
| `background:#1B1464` shorthand | **stripped** |
| `box-shadow:4px 4px 0 #000` | **stripped** |
| `bgcolor="#A7E8C4"` attribute | **survives** |
| borders, padding, `color` | survive |
| `<body style="…">` | **discarded entirely** — replaced with `<div dir="ltr">` |

Consequences for this project:

- Declare `background:` and `background-color:` as a **pair** on every element.
  `src/emails/replay-3-invite.html` does this — 29 of each, zero shorthand-only
  elements — so it survives intact apart from three flattened offset shadows.
- `marketing/replay-3/replay-3-invite-bgc.html` does **not** pair them (29
  shorthand-only). It would arrive with every panel colourless. It exists for an
  ESP send and needs fixing before use.
- Declare the font on every element, since body-level styles do not survive.
- Gmail **discards the plain-text part you supply** and generates its own from
  the HTML. `marketing/replay-3/invite.txt` is unused on this path.

## Quota — the binding constraint

**100 recipients per day** on the Google account. Not per message, not per
sending method — per account, counted across everything it sends including the
`Code.gs` registration confirmations. BCC recipients each count as one, so a
single wide BCC saves nothing, and 285 in one message would breach the separate
100-per-message limit as well.

Hence 41/day over seven days, leaving roughly 55/day of headroom for
confirmations. Moving `boardgamecompany.in` to Workspace (1500/day) or to an ESP
would collapse this to a single send.

## Deliverability

`boardgamecompany.in` publishes `v=spf1 include:spf.improvmx.com ~all` and has
**no DMARC record**. Mail through the alias carries `Return-Path:
boardgamecompany2024@gmail.com` and a DKIM signature for `1e100.net`, so neither
SPF nor DKIM aligns with the From domain. Nothing gets rejected — there is no
DMARC policy to enforce — but the domain vouches for none of this mail and builds
no reputation. The strongest argument for an ESP that DKIM-signs as
`boardgamecompany.in` before the next campaign.

## Email content — verified facts

Checked against `supabase/seeds/replay-3.sql` and the live site:

- REPLAY 3, Saturday 12 – Sunday 13 September 2026
- Indiqube Symphony, MG Road, Bengaluru
- Early bird ₹700/day (from ₹800), ₹1200 both days (from ₹1400)
- 250 seats per day, counted separately
- Registration open; all four links in the email resolve to live routes

Design follows `src/emails/registration.html`: cream page, white card with 4px
black border, orange header, deep blue floor panel, multi-coloured pills, black
footer, Tahoma throughout. Angle, per Sid: "you've played with us for an evening,
come play for a weekend."

Early bird is deliberately **undated** — Sid's call, 24 Aug 2026. The copy says
prices "go back up" with no date, in both the email and the WhatsApp message.

## History — the Apps Script relay, now retired

A `MailRelay.gs` web app was built as the send path before the connector was
available. It was pasted into the **same Apps Script project as `Code.gs`**, the
registration webhook, and both declared `doPost()`. Apps Script shares one global
namespace across files in a project, so the relay silently took over the
webhook's endpoint and answered the Worker's signed requests with
`bad_signature`.

Resolved 24 Aug 2026 by deleting `MailRelay.gs` from the project and redeploying;
a junk-signature probe now returns `Code.gs`'s bare
`{"ok":false,"error":"bad signature"}`. **Blast radius was zero** — the Worker
only emails a registration confirmation when `amountPaid === 0`
(`worker/src/register.ts:310`), all five registrations in the window were paid,
and there were no partner purchases.

`MailRelay.gs`, `SendInvite.gs`, `scripts/send-email.mjs` and `docs/EMAIL_RELAY.md`
were deleted with the relay. Two live send paths is what caused the collision;
one is enough. `mail-relay.env.local` in the repo root is gitignored and now
holds a secret for a script that no longer exists — delete it, and there is
nothing left to rotate.

## Open questions

1. **Unsubscribes.** The footer says "reply with unsubscribe", which is manual
   work landing in the BGC inbox. There is no suppression column on
   `public.users` in the `bgc-website` Supabase project. Worth adding before the
   next campaign — an ESP would handle this natively.
2. **Eight addresses were excluded** from the 293 valid-format rows:
   - four junk placeholders — `a@a.com`, `abc@123.com`, `no@no.com`,
     `placeholder@gmail.com`
   - one with a `.con` top-level typo, not corrected on a guess
   - two bare first-name Gmail addresses, near-certain placeholders that in
     practice belong to strangers
   - Sid's own

   The three real-looking ones are not quoted here for the same reason the
   recipient lists are gitignored. They are in `bgc-recipients.txt`'s source
   query output — re-run it and diff against the batch files to see exactly
   which rows were dropped, if that judgement needs revisiting.

## Data source

BGC list: Supabase project `bgc-website` (`yhgtwqdsnrslcgdvmunz`), `public.users`.
713 rows, 300 with an email, 293 unique and validly formatted, 285 after the
exclusions above.

```sql
select distinct lower(btrim(email)) from public.users
where email ~* '^[^@\s]+@[^@\s]+\.[a-z]{2,}$';
```
