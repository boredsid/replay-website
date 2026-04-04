# REPLAY - Bangalore's Board Game Convention

The official website for REPLAY, a board game convention held in Bangalore. Built entirely with vanilla HTML, CSS, and JavaScript — no frameworks, no build tools.

**Live at [replaycon.in](https://replaycon.in)**

## What's on the site

- **Landing page** — Photo carousel, about section, event schedule (Saturday/Sunday tabs), and ticket pricing
- **Registration flow** — Form capturing name, phone, email, pass type, day preference, and quantity
- **UPI payment sheet** — Bottom sheet with a dynamically generated QR code and deep links to Google Pay, PhonePe, and Paytm
- **Guild Path discounts** — Members of the REPLAY Guild Path get automatic discounts based on their membership tier (Initiate, Adventurer, Guildmaster), with fraud prevention to block split day-pass abuse
- **Google Sheets integration** — All registrations are logged to a Google Sheet via Apps Script

## Tech stack

- Vanilla HTML/CSS/JS
- Google Fonts (Alexandria, Amatic SC)
- Google Sheets as a backend (via Apps Script `doPost`)
- QR codes via [api.qrserver.com](https://api.qrserver.com)
- Hosted on GitHub Pages

## Built with Claude

This entire website — from the initial landing page through the registration flow, payment integration, and membership discount system — was built collaboratively with [Claude Code](https://claude.ai/claude-code) by Anthropic.
