# REPLAY live-event readiness

This is the handoff checklist for the dedicated live-event-readiness session.
It deliberately excludes privacy, consent, retention, and data-use copy, which
will be handled in the same future session only when explicitly approved.

## Content and event data

- Replace `TBD` with the confirmed venue name, full address, and map link. Verify
  the homepage, registration page, schedule, calendar links, confirmation email,
  and Event structured data after rebuilding.
- Populate the schedule before promoting the schedule link. Include doors open,
  check-in, game sessions, demonstrations, tournaments, breaks, and closing.
- Describe capacity as per-day capacity (for example, “250 spots each day”)
  unless the number genuinely represents distinct attendees.
- Verify the evidence behind claims such as “200+ games,” “hundreds of players,”
  publisher/designer demonstrations, and all-weekend tournaments. Soften or
  remove claims that are not operationally confirmed.
- Confirm every sponsor name, tier, logo, destination URL, and usage permission.
- Replace hard-coded weekday and month language with copy derived from edition
  dates so future editions cannot inherit stale “Saturday,” “Sunday,” or
  “September” labels.

## Attendee journey

- Add doors-open and check-in instructions, including what proof of registration
  attendees should bring and where payment questions are handled.
- Add a support contact and a same-day escalation route.
- Add venue accessibility, food/water, age policy, re-entry, parking/transit,
  prohibited-items, cancellation, and refund information.
- Decide what the “notify me” promise means operationally. The current form
  records a lead but does not itself send WhatsApp notifications.
- Test every registration route: each day pass, campaign pass, each Guild Path
  tier, sold-out day, sold-out campaign, duplicate registration, failed payment,
  confirmation, cancellation, and calendar download.

## Operations and launch checks

- Reconcile pending payments and define who confirms them, how often, and through
  which payment evidence.
- Confirm the on-site capacity/check-in source of truth and the procedure for
  releasing cancelled or expired pending reservations.
- Verify the Apps Script email webhook, Cloudflare Worker secrets, deploy hook,
  rate limits, and production security headers after final deployment.
- Run a desktop and mobile browser pass on the production site, including slow
  network, keyboard-only navigation, QR/deep-link payment, and screen-reader
  announcements.
- Run the data-sanity audit, automated tests, builds, dependency audits, and a
  backup/export immediately before registration opens.
- Prepare an incident fallback: registration pause, manual attendee capture,
  payment reconciliation, attendee communication, and rollback owner.

## Launch decision record

During the future session, record the confirmed venue, schedule owner, capacity
definition, notification mechanism, support contact, refund policy, registration
opening time, and the person authorized to pause registrations.
