# REPLAY live-event readiness

This is the source-of-truth roadmap for getting REPLAY ready for a live event.
It covers three connected surfaces with explicit execution gates:

1. The public website at `replaycon.in` — plan and execute in the current
   readiness session.
2. The organiser admin at `admin.replaycon.in` — plan now, execute in a
   dedicated follow-up session.
3. The attendee event-day app at `app.replaycon.in` — plan now, execute in a
   later dedicated session after the required admin operations exist.

Privacy, consent, retention, and data-use copy remain outside this roadmap
until explicitly approved. Social features in the attendee app are also a
follow-up rather than launch scope.

## Track 1 — public website

### Agreed information architecture

| Page | Primary job | Required content |
|---|---|---|
| Home | Explain REPLAY and move visitors to the right next step | Event essentials, experience, newcomer flow, ticket preview, schedule preview, visit preview, community, Guild Path, sponsors, partner CTA, final ticket CTA |
| Schedule | Help people decide what to attend | Date-derived day labels, doors/check-in, sessions, demonstrations, tournaments, breaks, closing, locations, descriptions, change notice |
| Tickets | Explain ticket choices and complete registration | Day and campaign comparison, inclusions, per-day availability, Guild Path discounts, payment/confirmation process, cancellation/refund summary, registration or notification form |
| Plan Your Visit | Remove arrival-day uncertainty | Venue, address/map, travel/parking, hours, check-in proof, accessibility, food/water, age policy, re-entry, what to bring, prohibited items, same-day support |
| Contact Us | Answer common questions and route unresolved ones | Ticket/payment, newcomer, schedule, venue, accessibility, cancellation/refund, contact and escalation answers |
| Get Involved | Convert prospective partners | Four paths: community engagement, book a paid booth, sponsor the event, or participate as a content creator; approved booth/engagement packages with website checkout, plus tailored sponsor/creator contact routes |

Past editions, store/pre-orders, and a standalone sponsor directory are not
launch-readiness pages. Revisit them after the core attendee journey is ready.

### Public content and event-data checklist

- Replace `TBD` with the confirmed venue name, full address, and map link.
  Verify Home, Tickets, Schedule, Plan Your Visit, calendar links,
  confirmation email, and Event structured data after rebuilding.
- Populate the schedule before promoting individual programme claims. Include
  all-day activities, timed sessions, playtests, publisher showcases, the event
  floor, doors/check-in, breaks, and closing. Internal space allocation and
  organiser responsibility are not public schedule fields.
- Describe capacity as per-day capacity unless a number genuinely represents
  distinct attendees.
- Verify evidence for claims such as “200+ games,” “hundreds of players,”
  publisher/designer demonstrations, and all-weekend tournaments. Soften or
  remove anything not operationally confirmed.
- Confirm every sponsor name, tier, logo, destination URL, and usage
  permission.
- Derive weekday, month, and time language from edition data. A future edition
  must not inherit stale Saturday, Sunday, or September copy.
- Keep the approved partner terms exact: booth Standard is ₹8,000 + GST for
  two days; booth Community is ₹6,500 + GST when the exhibitor gives REPLAY
  attendees at least 15% off its published price list; both include one table,
  power, and two two-day passes, while exhibitors bring signage. Community
  Engagement is ₹3,000 + GST per day for Standard or ₹3,500 + GST per day for
  Patron; both receive a three-hour/four-table slot and Patron includes one
  two-day pass. Cancellations close seven days before the event.
- REPLAY 3 uses one simple price set: ₹700 for either day or ₹1,200 for both
  days. No early-bird phase is in scope.

### Public attendee-journey checklist

- Publish doors-open and check-in instructions, including what proof of
  registration attendees should bring and where payment questions are handled.
- Publish a support contact and same-day escalation route.
- Publish venue accessibility, food/water, age policy, re-entry,
  parking/transit, prohibited-items, cancellation, and refund information.
- Keep the ticket-notification promise aligned with the actual operating
  process. Capturing a lead does not itself send a WhatsApp notification.
- Test each day ticket, campaign ticket, every Guild Path tier, sold-out day,
  sold-out campaign, duplicate registration, failed payment, confirmation,
  cancellation, and calendar download.
- Test every booth and community-engagement package, both engagement days,
  GST totals, abandoned and completed UPI handoffs, duplicate submissions,
  admin create/edit/status changes, and partner confirmation delivery.

### Public release checks

- Verify responsive navigation and all six pages on mobile and desktop.
- Run keyboard-only and screen-reader passes, including form errors, live spot
  updates, payment sheet, and schedule structure.
- Test slow network and unavailable Worker responses.
- Run root tests/build, production link checks, structured-data validation,
  sitemap checks, and dependency audit.
- Do not open ticket sales until venue, support, age, cancellation/refund, and
  payment-reconciliation details are published.

## Track 2 — organiser admin plan

The existing admin already covers the dashboard, editions, registrations,
users, leads, and the audit log. The dedicated admin-readiness session must
design and test the following operational scenario matrix before implementation.

### Event setup and publishing

- Manage schedule, sponsors, venue details, attendee guidance, and partner
  information without direct database edits. Programme editing covers public
  section, activity type, all-day/timed state, day, times, host, location,
  description, sign-up method/link, display order, and draft/published/cancelled
  status; it deliberately excludes internal capacity and staff responsibility.
- Preview public changes, trigger a site rebuild, show rebuild success/failure,
  and prevent staff from assuming a save is already live.
- Publish normal announcements, urgent notices, and an incident banner in the
  event-day app only. The protected editor, audited Worker APIs, and app surface
  are implemented; the remaining launch task is a production rehearsal of the
  authoring, scheduling, expiry, and rollback workflow.

### Registration and ticket-desk scenarios

- Find an attendee by name, phone, email, registration ID, or secure QR token.
- Handle confirmed, pending, cancelled, duplicate, wrong-day, wrong-ticket,
  missing-registration, complimentary, staff, partner, and walk-in cases.
- Support per-day check-in, re-entry, an undo for mistaken check-in, and a clear
  history of who performed each action.
- Reconcile UPI success with no visible registration, pending payment evidence,
  partial/overpayment, manual payment, discount disputes, cancellation, and
  refund status.
- Resend confirmations, correct contact details safely, and record internal
  notes without overwriting audit history.

### Capacity and incident controls

- Show held, pending, confirmed, checked-in, cancelled, and remaining capacity
  separately for each day.
- Pause/reopen ticket sales, release cancelled or expired pending holds, and
  prevent concurrent staff actions from overbooking.
- Provide a tested fallback for Worker, Supabase, payment, email, deploy-hook,
  internet, or device failure.

### Operational resilience

- Mobile-first ticket-desk layout, staff roles, least privilege, full audit
  history, exports, printable/offline roster, backups, and restore rehearsal.
- Products/orders remain conditional on whether pre-orders return.
- Schedule and sponsor management are required before the attendee app launches.

## Track 3 — attendee event-day app plan

Build `app.replaycon.in` as an installable, mobile-first PWA. Public utility
must work without signing in; secure personal features form a second but still
in-scope launch layer. The detailed delivery contract lives in
`docs/ATTENDEE_APP_PLAN.md`. Its Phase 1 public schedule/agenda shell, the
Phase 2 announcement slice, and the venue floor map are implemented; the
secure-ticket, check-in, and library phases remain gated by that plan.

### Public utility layer

- **Now:** current event, what starts next, opening/closing state, and urgent
  notices.
- **Schedule:** day/category/location filters and a device-local “My Day.”
- **Map:** rooms, play zones, help desk, food/water, accessibility points, and
  exits.
- **Event info:** check-in, rules, accessibility, food, transport, re-entry,
  support, and emergency guidance.
- **Offline:** cache the current schedule, map, ticket-desk location, and
  essential guidance.

### Secure attendee layer — in launch scope

- Secure ticket access without exposing attendee data: magic link, one-time
  code, or another deliberately chosen identity flow.
- Personal ticket status, QR pass, per-day check-in state, and confirmation
  recovery.
- Organiser announcements and optional push notifications with a clear consent
  boundary.
- Personal agenda synced only if the identity/privacy design supports it;
  otherwise keep “My Day” local to the device.

### Game-library borrowing — in launch scope

- Search and browse the available library with player count, duration,
  complexity, and availability.
- Borrow a specific copy through a staff-approved or secure self-service flow.
- Track available, checked out, overdue, returned, missing/damaged, and
  staff-resolved states.
- Show the borrower where to collect/return the game and when it is due.
- Give organisers a live circulation view, manual override, audit trail, and an
  offline fallback. **Shipped 2026-09-04**: Admin → Game library carries both a
  printable ledger and a CSV. The printed sheet deliberately has no phone
  numbers — it sits on a counter all day — while the CSV does, because chasing
  a game that walked needs a number and it is downloaded by an authenticated
  admin.

  **Unassigned: who reconciles the shelf at close.** Someone has to count what
  came back on Sunday, chase what did not, and decide what is written off.
  Nothing in the software can do this, and if nobody is named it does not
  happen. Name a person before the weekend.

- **Not built, deliberately:** an offline write queue for loans. Check-in has
  one; the library does not. The paper ledger covers the same failure — the
  venue network dropping mid-afternoon — with far less that can go wrong, and
  adding offline write-replay days before the event was judged a worse trade.
- Decide whether library inventory is imported from an existing BGC catalogue
  or maintained as REPLAY-specific copies before designing the schema.

### Explicit follow-up

- Attendee chat, social profiles, matchmaking/looking-for-group, and other
  moderation-heavy social features are not launch scope.
- Venue-map accessibility annotations and marked exits were removed from the
  software roadmap on 2026-09-02. `src/lib/venue-map.ts` accepts them once
  somebody has walked the building and established what they are; the blocker
  is that survey, not code.

### App dependencies

- Complete the admin check-in and library circulation workflows first, and
  rehearse the implemented announcement and programme workflows in production.
  The venue map is defined in code rather than published from admin; see
  `docs/VENUE_MAP.md`.
- Define identity, QR-token security, offline conflict resolution, push
  notification ownership, support staffing, and data/privacy boundaries before
  implementation.

## Cross-track operations and launch checks

- Reconcile pending payments and define who confirms them, how often, and
  through which payment evidence.
- Confirm the on-site capacity/check-in source of truth and the procedure for
  releasing cancelled or expired pending reservations.
- Verify Apps Script email webhook, Worker secrets, deploy hook, rate limits,
  production security headers, and app service-worker behavior after final
  deployment.
- Run data-sanity audit, all automated tests/builds, dependency audits, and a
  backup/export immediately before ticket sales and immediately before doors
  open.
- Prepare and rehearse an incident fallback: ticket-sales pause, manual
  attendee capture, offline check-in, game-loan ledger, payment reconciliation,
  attendee communication, and named rollback owner.

## Launch decision record

Before launch, record the confirmed venue/address/map, schedule owner, capacity
definition, notification mechanism, support and same-day contacts, age policy,
accessibility owner, cancellation/refund policy, ticket opening time, payment
reconciliation owner, check-in source of truth, library owner, incident
communications owner, and the person authorised to pause ticket sales.
