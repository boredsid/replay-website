# REPLAY 3 invite — send log

Seven drafts were created in the `hello@boardgamecompany.in` mailbox on
24 Aug 2026, one per batch, each with its 41 (or 39) recipients already in BCC.
**Sid schedules them by hand using Gmail's own Schedule send.** There is no
automated job — an earlier scheduled task was created and then deleted precisely
so nothing can fire twice.

## The email

- Subject: `Bengaluru's offline gaming weekend is back...`
- From: `Board Game Company <hello@boardgamecompany.in>` (a send-as alias on the
  consumer account `boardgamecompany2024@gmail.com`).
- To: `hello@boardgamecompany.in`, so a copy lands back in the mailbox as
  confirmation. Everyone else is in BCC and no recipient sees another.
- HTML: `src/emails/replay-3-invite.html`, verified end to end through a real
  Gmail round trip — every colour panel survives, the three offset shadows do
  not. See `docs/reference/REPLAY3_EMAIL_HANDOFF.md`.
- Plain text: **Gmail discards whatever plain-text part you supply** and
  generates its own from the HTML. `marketing/replay-3/invite.txt` is therefore
  unused on this path. Keep it for an ESP send.

## Order does not matter

Each draft carries a distinct, non-overlapping slice of the list, and together
they cover all 285 addresses exactly once. So it makes no difference which draft
goes out on which day — the only rule that matters is **each draft is sent
exactly once**. There is nothing to keep in sync and no way to mix them up.

## Batches

| Day | Batch file | Count | Scheduled for | Sent |
| --- | --- | --- | --- | --- |
| 1 | `batches/day-1.txt` | 41 | | |
| 2 | `batches/day-2.txt` | 41 | | |
| 3 | `batches/day-3.txt` | 41 | | |
| 4 | `batches/day-4.txt` | 41 | | |
| 5 | `batches/day-5.txt` | 41 | | |
| 6 | `batches/day-6.txt` | 41 | | |
| 7 | `batches/day-7.txt` | 39 | | |

Total 285.

The batch files and `bgc-recipients.txt` are **gitignored and exist on disk
only** — they hold real attendees' email addresses, and anything committed to git
history is permanent. Regenerate them from Supabase if they are ever lost; the
query is at the end of `docs/reference/REPLAY3_EMAIL_HANDOFF.md`. The seven drafts already
carry their recipients in BCC, so the campaign does not depend on these files.

## Why 41 a day

The ceiling is on the Google account, not on any particular sending method:
**100 recipients per day**, counted across everything that account sends,
including the `Code.gs` registration confirmations. BCC recipients each count as
one, so a single wide BCC saves nothing and 285 in one message would breach the
separate 100-per-message limit too. 41/day leaves roughly 55 a day of headroom
for confirmations.

## Deliverability note

`boardgamecompany.in` publishes `v=spf1 include:spf.improvmx.com ~all` and has no
DMARC record. Mail sent through the Gmail alias carries `Return-Path:
boardgamecompany2024@gmail.com` and a DKIM signature for `1e100.net`, so neither
SPF nor DKIM aligns with the From domain. Nothing will be rejected — there is no
DMARC policy to enforce — but the domain vouches for none of this mail. Worth
fixing with an ESP that DKIM-signs as `boardgamecompany.in` before the next
campaign.

## Also in the mailbox

Two test drafts that must **not** be sent to anyone but Sid:

- `CSS probe — do not send`
- `REPLAY 3 is open` — the render test, addressed only to
  `siddhantnarula96@gmail.com`, carrying the old subject line.

Both can be deleted once the campaign starts.
