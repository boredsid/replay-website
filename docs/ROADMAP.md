# What is not built yet

Open work, open decisions, and what was deliberately taken off the list.

This is one of two documents anyone maintains. The other is
[`DELIVERED.md`](DELIVERED.md), for what exists and why. Dated files under `docs/specs/`,
`docs/implementation/` and `docs/notes/` are write-once records and are never
revised.

**The "removed from scope" section is load-bearing.** Two items on it were
raised as outstanding work three and five times respectively, because they were
written into several documents and deleted from none. If something is decided
against, record it here rather than removing it silently.

---

## Open

Nothing. P7 (booking management in the admin) shipped on 2026-09-07 — see the
events board in [`DELIVERED.md`](DELIVERED.md).

Two things it deliberately did not do, recorded so they are decided rather than
forgotten:

- **Moving somebody between sessions in one action.** Remove then add does it in
  two clicks and never leaves a half-applied booking; a single "move" would be
  two RPC calls that can fail apart.
- **Seating a specific waitlisted person out of turn.** Promotion is strictly
  first-come, and the only way a seat opens is a cancellation. Letting staff
  jump the queue or seat somebody over capacity needs a new database function
  and a decision about what the queue then means — see the open decisions below.

---

## Open decisions

Things nobody has decided. Each blocks nothing today.

1. **Sign-ups and loans when a registration is cancelled after the fact.**
   Partly answered for the purchaser identity by
   `20260901184903_release_purchaser_claim.sql`. Low likelihood, messy if it
   happens.
2. **Whether a cancelled *session* should notify the people booked into it.**
   Today it sends nothing, and the only way to reach that roster is an urgent
   announcement, which goes to everybody. The one open decision with code
   behind it — roughly two hours if the answer is yes.
3. **Whether the QR needs unprompted rotation** before the next edition, if
   screenshot sharing turns out to happen. Re-pairing already rotates it.
4. **`renotify` on notifications.** A notice replacing an earlier one with the
   same tag currently arrives silently, which for a republished incident is
   probably wrong. One line.
5. **Whether staff may seat somebody out of queue order**, or over a session's
   capacity, when a host says to. Today neither is possible from any screen —
   promotion is first-come and capacity is enforced in the database. Raised by
   the events board (2026-09-07) and left undecided, because the answer changes
   what a waitlist position promises the person holding it.

## Not this edition

- **Venue accessibility annotations** — marked exits, step-free routes.
  `src/lib/venue-map.ts` accepts them; the blocker is walking the building with
  somebody who can verify them, which is not software. Removed from the software
  roadmap 2026-09-02.
- **An offline write queue for library loans.** Check-in has one. The paper
  ledger covers the same failure more simply, and adding offline write-replay
  close to an event is more risk than it removes. A deliberate omission, not an
  oversight.

## Explicitly out of scope

Attendee chat, social profiles, matchmaking, looking-for-group, and other
moderation-heavy social features.

---

## Removed from scope

Recorded so they are not raised again.

| Item | Removed | Why |
|---|---|---|
| **Named reconciliation owner** for the library ledger | 2026-09-05 | Never software. Who counts the shelf on Sunday is a rota question, and a name in an export header buys nothing the export does not already give you. Was written into five documents, which is why it kept resurfacing. *Payment* reconciliation is a different thing and remains. |
| **Who owns capacity numbers** | 2026-09-05 | Never a decision. Capacity is a number somebody types into the programme editor and `signup_mode` is the checkbox beside it — whoever edits the programme decides, exactly as they decide a session's title. |
| **P5 — venue accessibility annotations** | 2026-09-02 | Not abandoned as a goal, but not code. See "Not this edition". |
| **Library inventory source** (BGC import vs REPLAY-owned) | 2026-09-02 | Settled: REPLAY-owned copies, which include the BGC catalogue anyway. It also shaped far less than the spec claimed — it decides where title metadata comes from, not the loan model, which keys on copies either way. |
| **Reminder lead time** | 2026-09-02 | Settled at 15 minutes with a 10-minute catch-up window. |
| **Server-synced My Day** ("recommended against for launch") | 2026-09-02 | Reversed and built. A cron cannot read a phone, so a star that never left the device could never become a reminder — and for 28 of day one's 32 sessions the star is the only signal there is. The privacy cost was accepted deliberately. |

---

## How to plan new work

Two documents are maintained: this one and `DELIVERED.md`. Everything else is a
snapshot.

- **Small work** goes straight in here as an entry, and moves to `DELIVERED.md`
  when it ships.
- **A phase big enough to need thinking on paper** gets a dated spec in `docs/specs/`
  and a plan in `docs/implementation/`, following the existing
  `YYYY-MM-DD-<slug>` naming. Those are **working
  documents: live while the phase is active, abandoned the moment it ships, and
  never revised afterwards.** When it ships, the durable lessons — the ones that
  cost something to learn — graduate into `DELIVERED.md`, and the planning doc
  stays as a dated record nobody maintains.

The rule that keeps this from rotting: **only `DELIVERED.md` and `ROADMAP.md`
are ever updated.** A fact in a third place is a fact that will contradict them
within a fortnight.

`AGENTS.md` covers how to work in this repo — deploy order, migrations,
environment traps. It does not describe features; this pair does.
