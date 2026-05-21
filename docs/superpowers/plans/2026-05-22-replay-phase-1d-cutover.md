# REPLAY Phase 1D — Cutover Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cut `replaycon.in` apex DNS from GitHub Pages to the new Cloudflare Pages site, merge prerequisite PRs, delete legacy files from `main`, and verify all routes + subdomains work post-cutover.

**Architecture:** Big-bang cutover in one session. Sequence: merge bgc PR → cleanup commit on `rebuild/phase-0` → merge replay PR → switch CF Pages production branch → update GAS URL → disable GH Pages → swap apex DNS → bind apex + www to Pages → smoke. `registration_status` stays `upcoming` post-cutover; opening reg is a separate manual flip.

**Tech Stack:** Cloudflare Pages, Cloudflare DNS, GitHub (`gh` CLI), Google Apps Script (manual UI step), Supabase (read-only verification).

**Branch:** Phase 1D opens a PR from `rebuild/phase-0` → `main`. Once merged, all post-cutover work happens against `main`. `legacy-static` branch stays as git safety.

**Working directory:** `/Users/siddhantnarula/Projects/replay-website`.

---

## Task 1: Pre-flight checks (read-only)

**Files:** none modified.

- [ ] **Step 1: Verify worker tests still green**

Run:
```bash
cd /Users/siddhantnarula/Projects/replay-website/worker && npm test 2>&1 | tail -5
```
Expected: `Test Files 11 passed (11) · Tests 66 passed (66)`.

- [ ] **Step 2: Verify site tests still green**

Run:
```bash
cd /Users/siddhantnarula/Projects/replay-website && npm test 2>&1 | tail -5
```
Expected: `Test Files 5 passed (5) · Tests 24 passed (24)`.

- [ ] **Step 3: Verify build is clean**

Run:
```bash
npm run build 2>&1 | tail -3
```
Expected: `3 page(s) built` and exit 0.

- [ ] **Step 4: Verify production Supabase state**

Use `mcp__claude_ai_Supabase__execute_sql` with `project_id=qvkynwlmzeybdiapbcsy`:

```sql
select id, slug, is_published, is_current, registration_status from editions where slug='replay-3';
```

Expected: one row, `is_published=true`, `is_current=true`, `registration_status='upcoming'`.

- [ ] **Step 5: Verify preview site renders the new design**

Use `mcp__plugin_context-mode_context-mode__ctx_execute`:

```javascript
const res = await fetch('https://replay-website.pages.dev/');
const html = await res.text();
console.log({
  status: res.status,
  brutal: html.includes('replay-wordmark'),
  photo: html.includes('carousel-photos/3.jpeg'),
  hero: html.includes('A weekend of board games'),
});
```

Expected: `status=200, brutal=true, photo=true, hero=true`.

If any pre-flight fails, **stop** and fix before proceeding.

---

## Task 2: Merge bgc PR #15

**Files:** none in this repo modified (cross-repo).

> The bgc worker was already deployed to production in Phase 1A. Merging only brings `bgc-website/main` in line with reality.

- [ ] **Step 1: Verify PR is mergeable**

Run:
```bash
gh pr view 15 -R boredsid/bgc-website --json mergeable,state | tail -10
```
Expected: `"state": "OPEN", "mergeable": "MERGEABLE"`.

- [ ] **Step 2: Merge with squash**

Run:
```bash
gh pr merge 15 -R boredsid/bgc-website --squash --delete-branch
```
Expected: `✓ Squashed and merged pull request #15`.

- [ ] **Step 3: Verify**

Run:
```bash
gh pr view 15 -R boredsid/bgc-website --json state | tail -3
```
Expected: `"state": "MERGED"`.

---

## Task 3: Cleanup commit on rebuild/phase-0 (delete legacy files)

**Files:**
- Delete: `index.html`, `register.html`, `preorder.html`
- Delete: `email-confirmation.html`, `preorder-confirmation-email.html`
- Delete: `apps-script-preorder.js`
- Delete: `CNAME`
- Delete: `.github/workflows/deploy.yml`
- Keep: `link-preview.png`, `replay-logo.png`, `README.md`, `public/carousel-photos/`, `public/instagram.svg`

- [ ] **Step 1: Verify expected legacy files exist at repo root**

Run:
```bash
cd /Users/siddhantnarula/Projects/replay-website && ls index.html register.html preorder.html email-confirmation.html preorder-confirmation-email.html apps-script-preorder.js CNAME .github/workflows/deploy.yml 2>&1 | tail -10
```
Expected: all files listed without errors. If anything missing, investigate before deleting.

- [ ] **Step 2: Git rm the legacy files**

Run:
```bash
git rm index.html register.html preorder.html email-confirmation.html preorder-confirmation-email.html apps-script-preorder.js CNAME .github/workflows/deploy.yml
```

Expected: 8 files staged for deletion.

- [ ] **Step 3: Verify nothing referenced these files**

Run:
```bash
grep -rE "(index\.html|register\.html|preorder\.html|email-confirmation\.html|preorder-confirmation-email\.html|apps-script-preorder|CNAME)" src/ astro.config.mjs package.json 2>&1 | grep -v "^src/lib/data" | head -5
```
Expected: no matches (or only references inside docs/, which don't affect runtime).

If any runtime file references them, **stop** and update before continuing.

- [ ] **Step 4: Commit**

Run:
```bash
git commit -m "Phase 1D: Remove legacy GitHub Pages site files

Pre-cutover cleanup. Apex DNS will swap from GitHub Pages to the new
Cloudflare Pages site immediately after this lands on main. The
legacy-static branch retains all of these files as git safety.

Files removed:
- index.html, register.html, preorder.html (legacy pages)
- email-confirmation.html, preorder-confirmation-email.html (legacy email templates)
- apps-script-preorder.js (paste-bait for legacy GAS, replaced by apps-script/Code.gs)
- CNAME (GitHub Pages apex binding)
- .github/workflows/deploy.yml (GitHub Pages deploy workflow)

Kept:
- link-preview.png (Layout.astro OG meta)
- replay-logo.png (favicon)
- README.md
- public/carousel-photos/ (hero source)
- public/instagram.svg (footer icon)

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

- [ ] **Step 5: Verify build still works**

Run:
```bash
npm run build 2>&1 | tail -3
```
Expected: `3 page(s) built`.

- [ ] **Step 6: Push**

Run:
```bash
git push
```

Expected: branch `rebuild/phase-0` updated on origin. CF Pages auto-deploys but production branch is still `rebuild/phase-0` — preview deploy happens at the *.pages.dev URL. Wait ~60s.

---

## Task 4: Open + merge replay PR rebuild/phase-0 → main

**Files:** none modified.

- [ ] **Step 1: Open the PR**

Run:
```bash
cd /Users/siddhantnarula/Projects/replay-website
gh pr create --base main --head rebuild/phase-0 \
  --title "Phase 1: Astro + worker + admin shell rebuild" \
  --body "$(cat <<'EOF'
## Summary

Complete Phase 1 of the REPLAY website rebuild, replacing the legacy vanilla-HTML + Google Sheets static site with an Astro 6 + Cloudflare Worker + Supabase + admin SPA stack.

This PR closes Phases 1A (worker), 1B (site pages), 1C (design overhaul), and 1D (cutover).

## What ships

- **Worker** (`worker/`): 5 endpoints (lookup-phone, register, edition-spots, cancel-registration, lead) + 1 health endpoint. 66/66 Vitest tests green. Deployed to `api.replaycon.in`.
- **Site** (`src/`): Astro 6 + React 19 islands. 3 pages (`/`, `/register`, `/schedule`). 24/24 site tests green. Currently on `replay-website.pages.dev`; this PR cuts the apex over.
- **Admin** (`admin/`): Vite + React SPA shell. Phase 0 scaffold; full CRUD comes in Phase 3.
- **Supabase**: 9 tables + RLS. REPLAY 3 edition seeded (`is_published=true, is_current=true, registration_status='upcoming'`).
- **GAS**: Replay Email Webhook project sends confirmation emails via the worker's HMAC-signed `/exec` endpoint.
- **Design**: Brutalist system ported from bgc-website with replay-distinct palette (orange + teal + yellow + violet on cream).

## Cutover sequence (executed after merge)

1. Merge this PR.
2. Switch CF Pages production branch `rebuild/phase-0` → `main`.
3. Update Replay GAS Code.gs template URL `rebuild/phase-0` → `main`; redeploy GAS web app.
4. Disable GitHub Pages in repo Settings.
5. Swap apex DNS at Cloudflare from GH Pages → CF Pages.
6. Smoke-test all routes + subdomains.

## Rollback

`legacy-static` branch retains the full pre-rebuild tree. `git push origin legacy-static:main --force` is the nuclear undo.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

Expected: PR URL printed. Note it for the next step.

- [ ] **Step 2: Check CI status (Cloudflare Pages preview deploy)**

Run:
```bash
gh pr checks --watch
```

Wait for the CF Pages preview deploy to complete (should be ~60-90s). Expected: ✓ on all checks.

- [ ] **Step 3: Squash-merge the PR**

Run:
```bash
gh pr merge --squash --delete-branch
```

Expected: `✓ Squashed and merged...`. Origin's `rebuild/phase-0` branch is deleted. Local `rebuild/phase-0` still exists but is no longer tracked.

- [ ] **Step 4: Pull main locally**

Run:
```bash
git checkout main
git pull
git log -1 --oneline
```

Expected: top commit is the squash-merge commit. Working directory clean.

---

## Task 5: Switch CF Pages production branch (USER ACTION)

**Files:** none modified.

> **User action required.** Cloudflare Pages production branch is changed in the dashboard.

- [ ] **Step 1: Switch the production branch**

Cloudflare dashboard → Workers & Pages → `replay-website` (the site project, NOT `replay-admin`) → Settings → Builds & deployments → **Production branch**: change from `rebuild/phase-0` to `main`. Save.

- [ ] **Step 2: Trigger a deploy from main**

Same page → Deployments tab → click "Create deployment" (or the equivalent button) and select the `main` branch.

Alternative: any push to `main` triggers it. Task 4 Step 4's `git pull` doesn't push — manually trigger from dashboard.

- [ ] **Step 3: Wait for the deploy to complete**

Watch the Deployments tab. Expect ~60-90s for build. Status goes Queued → Building → Deploying → Success.

- [ ] **Step 4: Verify *.pages.dev URL serves from main**

Use `mcp__plugin_context-mode_context-mode__ctx_execute`:

```javascript
async function check() {
  const res = await fetch('https://replay-website.pages.dev/');
  const html = await res.text();
  return { brutal: html.includes('replay-wordmark'), hasReplay3: html.includes('REPLAY 3') };
}
for (let i = 0; i < 6; i++) {
  const r = await check();
  console.log(`attempt ${i+1}:`, r);
  if (r.brutal && r.hasReplay3) break;
  await new Promise(r => setTimeout(r, 15000));
}
```

Expected: still 200 with brutal + REPLAY 3 markers. (Content shouldn't change — same code, just from main now.)

---

## Task 6: Update Replay Apps Script template URL (USER ACTION)

**Files:** `apps-script/Code.gs` in repo is reference paste-bait; the real GAS project lives in Google.

> **User action required.**

- [ ] **Step 1: Open the Replay Email Webhook GAS project**

https://script.google.com → find `Replay Email Webhook` → open the editor.

- [ ] **Step 2: Edit the template URL in Code.gs**

Find this line in `renderTemplate(template, vars)`:

```js
'replay-registration': 'https://raw.githubusercontent.com/boredsid/replay-website/rebuild/phase-0/src/emails/registration.html',
```

Change to:

```js
'replay-registration': 'https://raw.githubusercontent.com/boredsid/replay-website/main/src/emails/registration.html',
```

Save (Cmd-S).

- [ ] **Step 3: Deploy a new version of the active deployment**

Deploy → Manage deployments → pencil icon on the row marked "Active" → Version: "New version" → Description: `point templates at main post-cutover` → Deploy.

Critical: edit the existing deployment, don't create a new one. The `/exec` URL must stay the same so `APPS_SCRIPT_URL` worker secret stays valid.

- [ ] **Step 4: Smoke test the GAS webhook against the new URL**

Use `mcp__plugin_context-mode_context-mode__ctx_execute`:

```javascript
const SECRET = 'fe09d9e815865d0e13f4eba344a98ddf4da68f05dd778d253bca06dc46660979';
const GAS_URL = 'https://script.google.com/macros/s/AKfycbyd2DLE_Ll8ekxwHfPod15LE49CrhlDQqUEHjo7rB-mOEQTNLya0A61hOUj9rAv9iATtQ/exec';

const payload = {
  template: 'replay-registration',
  to: 'siddhantnarula96@gmail.com',
  subject: 'Phase 1D cutover GAS smoke',
  variables: { name: 'Cutover Smoke', edition_name: 'REPLAY 3', venue: 'TBD', start_date: '2026-09-12', end_date: '2026-09-13', pass_type: 'oneshot', days_label: 'Saturday', seats: 1, amount_paid: 0, discount_applied: 800, guild_tier: 'guildmaster' },
};
const body = JSON.stringify(payload);
const crypto = require('crypto');
const signature = crypto.createHmac('sha256', SECRET).update(body).digest('hex');
const url = new URL(GAS_URL);
url.searchParams.set('X-Signature', signature);
const res = await fetch(url.toString(), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
console.log('status=' + res.status, await res.text());
```

Expected: `status=200 {"ok":true}`. Confirms GAS is fetching the email template from `main` successfully. Check inbox for the test email (may go to spam initially).

---

## Task 7: Disable GitHub Pages (USER ACTION)

**Files:** none modified.

> **User action required.** Belt-and-suspenders so GH Pages can't reclaim the apex if Cloudflare DNS has a hiccup.

- [ ] **Step 1: Disable Pages source**

GitHub → `boredsid/replay-website` → Settings → Pages (left sidebar) → Build and deployment → **Source**: change to "None" (or whatever the "disable" option is named in the current GH UI).

- [ ] **Step 2: Verify no GH Pages workflow can run**

Run:
```bash
ls .github/workflows/ 2>&1 | head -5
```

Expected: empty directory OR `ls: .github/workflows/: No such file or directory`. (Task 3 deleted `deploy.yml`; if the directory was empty it may have been removed.)

If a `.github/workflows/deploy.yml` somehow exists, delete it now with `git rm` + commit + push.

---

## Task 8: Apex DNS swap (USER ACTION)

**Files:** none modified.

> **User action required.** Critical step — site will be briefly unavailable (~30-90s) while CF Pages provisions SSL.

- [ ] **Step 1: Delete GitHub Pages records in Cloudflare DNS**

Cloudflare dashboard → DNS for `replaycon.in` zone → find and delete:

| Type | Name | Content |
|---|---|---|
| A | replaycon.in (apex) | 185.199.108.153 |
| A | replaycon.in (apex) | 185.199.109.153 |
| A | replaycon.in (apex) | 185.199.110.153 |
| A | replaycon.in (apex) | 185.199.111.153 |
| AAAA | replaycon.in (apex) | 2606:50c0:8000::153 |
| AAAA | replaycon.in (apex) | 2606:50c0:8001::153 |
| AAAA | replaycon.in (apex) | 2606:50c0:8002::153 |
| AAAA | replaycon.in (apex) | 2606:50c0:8003::153 |
| CNAME | www | boredsid.github.io |

9 records total. After deletion, apex will be unreachable until step 2's Pages binding completes — expected.

- [ ] **Step 2: Verify deletions**

Use `mcp__plugin_context-mode_context-mode__ctx_execute`:

```javascript
// Query 1.1.1.1 to bypass local DNS cache
const dns = require('node:dns/promises');
try {
  const a = await dns.resolve4('replaycon.in').catch(() => []);
  const aaaa = await dns.resolve6('replaycon.in').catch(() => []);
  const cname = await dns.resolveCname('www.replaycon.in').catch(() => []);
  console.log({ a, aaaa, cname });
} catch (e) {
  console.log('resolve error', e.message);
}
```

Expected: empty arrays for all three. May take 30-60s for the deletion to propagate.

---

## Task 9: Bind apex + www to Pages project (USER ACTION)

**Files:** none modified.

> **User action required.**

- [ ] **Step 1: Bind apex to the `replay-website` Pages project**

Cloudflare → Workers & Pages → `replay-website` → Custom Domains → **Add a custom domain** → `replaycon.in` → Continue → Activate domain.

Cloudflare auto-creates the right DNS record (a CNAME or A pointing to its edge). Wait for status to show **Active** (~30-90s). During this window apex returns Cloudflare's placeholder or a brief cert error — expected.

- [ ] **Step 2: Bind www**

Same page → Add a custom domain → `www.replaycon.in` → Activate. Wait for **Active**.

- [ ] **Step 3: Confirm DNS propagated**

Use `mcp__plugin_context-mode_context-mode__ctx_execute`:

```javascript
async function dig(host) {
  const dns = require('node:dns/promises');
  const a4 = await dns.resolve4(host).catch(() => []);
  const a6 = await dns.resolve6(host).catch(() => []);
  return { host, a4, a6 };
}
for (let i = 0; i < 6; i++) {
  const a = await dig('replaycon.in');
  const b = await dig('www.replaycon.in');
  console.log(`attempt ${i+1}:`, a, b);
  if (a.a4.length > 0 && b.a4.length > 0) break;
  await new Promise(r => setTimeout(r, 15000));
}
```

Expected: both resolve to Cloudflare IPs (likely in the 172.x.x.x or 104.x.x.x ranges — NOT 185.199.x.x).

---

## Task 10: Smoke at apex

**Files:** none modified. Read-only verification.

- [ ] **Step 1: Run the full smoke battery**

Use `mcp__plugin_context-mode_context-mode__ctx_execute`:

```javascript
async function get(url) {
  try {
    const res = await fetch(url, { redirect: 'manual' });
    const text = await res.text();
    return { url, status: res.status, len: text.length, sniff: text.slice(0, 200) };
  } catch (e) { return { url, error: e.message }; }
}

// Apex serves new site
const apex = await get('https://replaycon.in/');
console.log('[1] apex:', apex.status, 'brutal=' + apex.sniff?.includes('REPLAY'));

// www
const www = await get('https://www.replaycon.in/');
console.log('[2] www:', www.status);

// Legacy URLs 404
const reg404 = await get('https://replaycon.in/register.html');
console.log('[3] register.html:', reg404.status);
const preorder404 = await get('https://replaycon.in/preorder.html');
console.log('[4] preorder.html:', preorder404.status);

// New routes
const newReg = await get('https://replaycon.in/register');
const newSched = await get('https://replaycon.in/schedule');
console.log('[5] /register:', newReg.status, 'notifyMe=' + newReg.sniff?.includes('opens soon'));
console.log('[6] /schedule:', newSched.status);

// Subdomains
const api = await get('https://api.replaycon.in/api/health');
console.log('[7] api health:', api.status, api.sniff);
const admin = await get('https://admin.replaycon.in/');
console.log('[8] admin gate:', admin.status, '(expect 302 to CF Access)');

// Sitemap
const sm = await get('https://replaycon.in/sitemap-index.xml');
console.log('[9] sitemap:', sm.status);

// OG image
const og = await get('https://replaycon.in/link-preview.png');
console.log('[10] OG image:', og.status);
```

Expected:
- [1] 200, brutal=true
- [2] 200 (or 301 to apex)
- [3] 404
- [4] 404
- [5] 200, notifyMe=true
- [6] 200
- [7] 200 with `{"ok":true,"env":"production"}`
- [8] 302
- [9] 200
- [10] 200

If any failure that doesn't self-resolve within 5 min: see Rollback in the spec doc.

- [ ] **Step 2: Submit a notify-me lead via the live form**

Use the browser. Visit `https://replaycon.in/register`. Type phone `9000000077`. Click "Notify me". Should see "Got it. We'll be in touch."

Verify via Supabase MCP `execute_sql`:

```sql
select phone, edition_id, step_reached, created_at from leads where phone='9000000077';
```

Expected: one row. Then cleanup:

```sql
delete from leads where phone='9000000077';
```

- [ ] **Step 3: Verify SSL is valid**

Visit `https://replaycon.in/` and `https://www.replaycon.in/` in a browser. Both should show the lock icon (no warnings). Cloudflare-issued cert, auto-renewed.

---

## Task 11: Update CLAUDE.md with cutover learnings

**Files:**
- Modify: `CLAUDE.md` (append Session learnings)

- [ ] **Step 1: Append entries to the bottom of CLAUDE.md**

Add under "Session learnings":

```markdown
- 2026-05-22 — Phase 1D cutover shipped: apex `replaycon.in` now served by Cloudflare Pages from `main`, not GitHub Pages. www bound to the same Pages project. Legacy `*.html` files + `CNAME` + `.github/workflows/deploy.yml` removed from `main` (still in `legacy-static` branch). **Why it matters:** the apex is no longer reachable through GitHub Pages — re-enabling it requires re-adding the 4 A + 4 AAAA records + a CNAME, plus enabling GH Pages in repo Settings. The full rollback recipe is in the Phase 1D spec.
- 2026-05-22 — Replay Apps Script `Code.gs` template URL points at `main` post-cutover (was `rebuild/phase-0` during 1A-1C). **Why it matters:** future edits to `src/emails/registration.html` must land on `main` (via PR) for GAS to pick them up. Direct edits on a branch only show up after merging.
```

(Add any other learnings discovered during cutover — DNS quirks, GAS deploy surprises, etc.)

- [ ] **Step 2: Commit + push**

Run:
```bash
git add CLAUDE.md
git commit -m "Document Phase 1D cutover learnings

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
git push
```

---

## Definition of Done

- [ ] bgc PR #15 merged.
- [ ] Replay PR `rebuild/phase-0` → `main` merged.
- [ ] Legacy files removed from `main`.
- [ ] CF Pages `replay-website` project's production branch = `main`; deploy from `main` is the active production.
- [ ] Replay Apps Script `Code.gs` URL points at `main`; web app redeployed.
- [ ] GitHub Pages disabled in repo Settings.
- [ ] `replaycon.in` resolves to Cloudflare Pages.
- [ ] `www.replaycon.in` resolves or 301-redirects to apex.
- [ ] All 10 smoke checks pass.
- [ ] `api.replaycon.in/api/health` still returns 200 (worker unaffected).
- [ ] `admin.replaycon.in/` still CF-Access-gated (admin unaffected).
- [ ] CLAUDE.md updated with cutover learnings.

After this plan: opening registration (`registration_status='open'`) is a separate manual action whenever user is ready. Plan for that: `update editions set registration_status='open' where slug='replay-3';` + fire deploy hook (`https://api.cloudflare.com/client/v4/pages/webhooks/deploy_hooks/01e9488c-00cc-4c38-aa87-9be5820a51f7`) → site rebuilds with the live form.
