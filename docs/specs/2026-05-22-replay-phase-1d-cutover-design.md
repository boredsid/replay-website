# REPLAY Phase 1D — Cutover

**Date:** 2026-05-22
**Status:** Approved (brainstorm complete; implementation plan pending)
**Parent:** `docs/superpowers/specs/2026-05-18-replay-rebuild-design.md`
**Predecessors:** Phase 1A (worker), Phase 1B (site pages), Phase 1C (design overhaul)
**Branch:** Phase 1D opens a PR `rebuild/phase-0` → `main` and proceeds on `main`. `legacy-static` branch stays as git safety.

## Goal

Move `replaycon.in` apex DNS from GitHub Pages (legacy static site) to the new Cloudflare Pages site, merging all open prerequisite work and cleaning legacy files from `main`. Single-session big-bang cutover. `editions.registration_status` stays `upcoming` post-cutover — opening registration is a separate manual flip when user is ready.

## Non-goals

- Opening registration (`registration_status='open'`) — post-cutover manual action.
- Legacy URL redirects (`/register.html` → `/register`) — chosen hard-404.
- Email blast to leads — empty table currently; user-initiated when relevant.
- Newsletter / press announcement.
- Playwright E2E — punted out of Phase 1; revisit as a hardening phase.
- Any new visual work (the major redesign is tracked separately).

## Decisions captured

| Decision | Choice |
|---|---|
| Cutover sequencing | **A. Big-bang** — all steps in one session, ~5-15 min apex unavailable during SSL provisioning |
| Legacy URL handling | **A. Hard 404** — no Astro redirects |
| Rollback posture | **B. Delete and commit forward** — `legacy-static` branch is the only safety net |
| Opening registration | **B. Cutover only, flip status later** |

## Pre-flight (read-only)

Before opening the cutover PR:

1. `cd worker && npm test` → 66/66 green.
2. `npm test` at root → 24/24 green.
3. `npm run build` → clean.
4. Visit `https://replay-website.pages.dev/` → new site renders (Phase 1C styled).
5. Verify in Supabase Studio: `editions` row for `replay-3` has `is_published=true`, `is_current=true`, `registration_status='upcoming'`.

## Cutover sequence

Order matters. Each step is verified before the next.

### Step 1 — Merge bgc PR #15

bgc worker already deployed in production (Phase 1A). Merge brings `bgc-website/main` in line with reality.

```bash
gh pr merge -R boredsid/bgc-website 15 --squash --delete-branch
```

### Step 2 — Open replay PR rebuild/phase-0 → main

Diff is huge (every Phase 1 commit). PR is bookkeeping; you've reviewed task-by-task.

```bash
gh pr create -R boredsid/replay-website --base main --head rebuild/phase-0 \
  --title "Phase 1 rebuild: Astro + worker + admin shell + design overhaul" \
  --body "<see plan>"
```

### Step 3 — Cleanup commit on the PR

Before merging, push a final commit on `rebuild/phase-0` that removes legacy files:

```bash
git rm index.html register.html preorder.html
git rm email-confirmation.html preorder-confirmation-email.html
git rm apps-script-preorder.js
git rm CNAME
git rm .github/workflows/deploy.yml
git commit -m "Phase 1D: remove legacy GitHub Pages site files"
git push
```

**Keep** `link-preview.png` (used in Layout.astro's OG meta) and `replay-logo.png` (favicon).

### Step 4 — Merge the PR into main

```bash
gh pr merge --squash --delete-branch  # or merge commit if user prefers — squash is cleaner
```

`rebuild/phase-0` is deleted from origin after merge. (`legacy-static` and `main` remain.)

### Step 5 — Switch CF Pages production branch

Cloudflare dashboard → Workers & Pages → `replay-website` → Settings → Builds & deployments → **Production branch**: change `rebuild/phase-0` → `main`. Trigger a deploy from `main`. Wait for green build (~60-90s).

### Step 6 — Update Replay Apps Script template URL

Open the Replay Email Webhook GAS project → `Code.gs` → in the `urls` map change `…/rebuild/phase-0/src/emails/registration.html` → `…/main/src/emails/registration.html`. Save. Deploy → Manage deployments → pencil-edit active deployment → "New version" → Deploy. (Same `/exec` URL — `APPS_SCRIPT_URL` worker secret stays valid.)

### Step 7 — Disable GitHub Pages serving for the repo

GitHub repo → Settings → Pages → Build and deployment → Source → **None / Disabled**. Belt-and-suspenders so GH Pages can't claim the apex if CF DNS hiccups.

### Step 8 — Apex DNS swap in Cloudflare

Cloudflare → DNS → records on `replaycon.in`:

- Delete the 4 `A` records: `185.199.108.153`, `185.199.109.153`, `185.199.110.153`, `185.199.111.153`
- Delete the 4 `AAAA` records: `2606:50c0:8000::153`, `2606:50c0:8001::153`, `2606:50c0:8002::153`, `2606:50c0:8003::153`
- Delete the `www` CNAME pointing at `boredsid.github.io`

### Step 9 — Bind apex + www to Pages project

CF Pages → `replay-website` → Custom Domains → Add `replaycon.in`. Wait until status shows "Active" (auto-creates the correct DNS record + provisions SSL). Then Add `www.replaycon.in`.

SSL provisioning is ~30-90s for each. During this window apex returns Cloudflare's "There's nothing here" placeholder OR a brief cert error — that's expected, don't roll back.

### Step 10 — Smoke at apex (see Smoke section)

If everything passes, proceed to step 11. If something fails, see Rollback.

### Step 11 — Update CLAUDE.md

Append Phase 1D learnings (cutover gotchas hit, anything surprising). Commit + push.

## Smoke tests

After Step 9 completes ("Active" on both custom domains):

1. **Apex resolves to Cloudflare:**
   ```
   dig +short replaycon.in @1.1.1.1
   ```
   Expect a Cloudflare-assigned IP, NOT `185.199.x.x`.

2. **HTTPS at apex returns the new site:**
   ```js
   GET https://replaycon.in/
   ```
   200 + HTML contains `replay-wordmark`, `carousel-photos/3.jpeg`, `REPLAY 3`.

3. **www works:**
   ```js
   GET https://www.replaycon.in/
   ```
   200 with new site content, OR 301 to `https://replaycon.in/` — either is fine. (CF Pages handles either depending on config.)

4. **Legacy URLs hard-404:**
   ```js
   GET https://replaycon.in/register.html → 404
   GET https://replaycon.in/preorder.html → 404
   ```

5. **New routes work:**
   ```js
   GET https://replaycon.in/register → 200 with NotifyMeForm
   GET https://replaycon.in/schedule → 200 with "Schedule coming soon"
   ```

6. **Subdomains unaffected:**
   ```js
   GET https://api.replaycon.in/api/health → 200 {ok:true}
   GET https://admin.replaycon.in/ → 302 (CF Access)
   ```

7. **Sitemap reachable:**
   ```js
   GET https://replaycon.in/sitemap-index.xml → 200, XML
   ```

8. **OG image resolves:**
   ```js
   GET https://replaycon.in/link-preview.png → 200, image bytes
   ```

9. **Notify-me submit works (browser):** submit a synthetic phone (e.g. `9000000077`) on `/register`. Verify lead row in Supabase. Cleanup.

10. **SSL valid:** browser shows lock icon. Cloudflare-issued cert, auto-renewed.

## Rollback

If any smoke check fails and CF Pages domain remains broken after 5 min:

**Apex broken:**
1. CF Pages → Custom Domains → Remove `replaycon.in` (and `www.replaycon.in`).
2. Cloudflare DNS → re-add the 4 A records (`185.199.108-111.153`), 4 AAAA records (`2606:50c0:8000-8003::153`), and `www` CNAME → `boredsid.github.io`.
3. GitHub repo → Settings → Pages → re-enable Source from `legacy-static` branch.
4. Recovery: 5-15 min for DNS propagation.

**main build broken on CF Pages:**
1. CF Pages → revert production branch back to `rebuild/phase-0`.
2. Investigate the diff (should be only legacy-file deletions). If any of those files were imported somewhere, the build error will reveal it.

**Email pathway broken (GAS):**
1. Test the GAS `/exec` URL with a signed payload (Phase 1A Task 14 pattern). Inspect GAS Executions tab.
2. Common cause: GAS URL change in Step 6 didn't deploy a new version. Confirm via Deploy → Manage deployments — the active deployment must show "Version 3" (or whichever is latest), not the older one.

**Worker unaffected:** `api.replaycon.in` is independent of the apex DNS swap. If worker breaks during cutover, the cause is unrelated — diagnose via `wrangler tail`.

**Last resort (full repo rollback):**
```bash
git push origin legacy-static:main --force
```
CF Pages auto-deploys from `main` and serves the legacy site (after GH Pages re-enable in step 3 of the apex rollback). Destructive — only if convinced the new site is fundamentally broken.

## Definition of Done

- [ ] bgc PR #15 merged.
- [ ] Replay PR `rebuild/phase-0` → `main` merged.
- [ ] Legacy files removed from `main`.
- [ ] CF Pages `replay-website` production branch = `main`; deploy from `main` green.
- [ ] Replay Apps Script `Code.gs` URL → `main`; web app redeployed.
- [ ] GitHub Pages disabled in repo Settings.
- [ ] `replaycon.in` resolves to CF Pages.
- [ ] `www.replaycon.in` resolves or 301-redirects to apex.
- [ ] All 10 smoke checks pass.
- [ ] `api.replaycon.in/api/health` still 200.
- [ ] `admin.replaycon.in/` still CF-Access-gated.
- [ ] CLAUDE.md updated with cutover learnings.

## Deferred items (carried forward)

| Item | Target |
|---|---|
| Flip `editions.registration_status='open'` for replay-3 + fire deploy hook | Manual, user-initiated, post-cutover |
| `/preorder` page + endpoint + products + email | 1B-extra (when catalog is ready) |
| `/editions/[slug]` archive page | Phase 2 |
| Historical edition import (replay-1, replay-2) | Phase 2 |
| Major visual redesign | future phase (tracked in TaskCreate) |
| Full admin tool | Phase 3 |
| Playwright E2E coverage | hardening phase, post-launch |
| Email blast to leads when registration opens | manual, user-initiated |
