# Ops dashboard — where it lives, how to use it, GitHub

## Live links (GitHub Pages + repo)

| What | URL |
|------|-----|
| **GitHub repository** (same tree as your Desktop `Hit-A-Lick` folder — dashboard source is **`site/`**) | [github.com/Almightybruce01/Hit-A-Lick](https://github.com/Almightybruce01/Hit-A-Lick) |
| **Ops desk (direct)** | [almightybruce01.github.io/Hit-A-Lick/ops-dashboard.html](https://almightybruce01.github.io/Hit-A-Lick/ops-dashboard.html) |
| **Short path** (`/ops/` → same desk) | [almightybruce01.github.io/Hit-A-Lick/ops/](https://almightybruce01.github.io/Hit-A-Lick/ops/) |

Deployments run on every push to **`main`** via **`.github/workflows/pages.yml`** (GitHub Actions → Pages).

**Use only the `github.io` links in the table.** If GitHub Pages on your account is set to a custom domain and links break, turn that off under **GitHub → Settings → Pages** so **`almightybruce01.github.io/Hit-A-Lick/...`** loads normally.

## On your Mac (Desktop / repo)

Canonical file in the project:

**`site/ops-dashboard.html`**

### Desktop shortcut (canonical — live HTTPS only)

Do **not** rely on a local `file://` symlink to `site/ops-dashboard.html` (API + security headers expect HTTPS).

On your Mac **Desktop** (root, not inside a folder):

1. **`bash scripts/install-live-dashboard-desktop.sh`** → **`Hit-A-Lick-Ops-Desk.webloc`** opens **`https://almightybruce01.github.io/Hit-A-Lick/ops-dashboard.html`**.

2. **`bash scripts/link-ops-dashboard-desktop.sh`** → same webloc + **`Hit-A-Lick-Ops-Desk-README.txt`**, and removes legacy Desktop files **`HitALick-OpsControl-PublicDashboard-PIN2012.html`** / old README if present.

Double-click the **`.webloc`** to open the live desk in the browser.

## Deployed URL (Firebase — recommended for API same-origin)

After `firebase deploy --only hosting`, your site serves:

- **`https://<your-project>.web.app/ops`** → rewrites to `ops-dashboard.html` (see `firebase.json`).

Bookmark **`/ops`** on your phone/desktop — that is the “saved dashboard” link that talks to **`/api/**`** on the same host.

**Firebase Hosting hardening** (see `firebase.json`): `ops-dashboard.html` and **`/ops`** get `Cache-Control: no-store`, `X-Frame-Options: DENY`, `X-Robots-Tag: noindex, nofollow, noarchive`, and a strict **`Content-Security-Policy`** (tight `connect-src https:`). GitHub Pages cannot set those HTTP headers; the desk HTML includes a matching **`<meta http-equiv="Content-Security-Policy">`** for parity.

## PIN (`OPS_DASHBOARD_PIN`)

The API accepts:

- Header **`X-Ops-Pin: <secret>`** (set with Firebase / Cloud Functions secret **`OPS_DASHBOARD_PIN`**; do not commit the live value),

**or**

- **`Authorization: Bearer <Firebase ID token>`** for **`OWNER_EMAIL`** only.

The static page stores the PIN in **sessionStorage** after you unlock — it is **not** committed to GitHub. Change the live PIN with:

```bash
firebase functions:secrets:set OPS_DASHBOARD_PIN
```

Redeploy `api` after changing secrets.

## Clone / update from GitHub

```bash
cd ~/Desktop
git clone https://github.com/Almightybruce01/Hit-A-Lick.git
cd Hit-A-Lick
git pull
```

## After using Cursor — improve the dashboard

1. Edit **`site/ops-dashboard.html`** (HTML/CSS/JS in one file).
2. **`git add` / `git commit` / `git push`** — GitHub Pages updates automatically.
3. Or run **`firebase deploy --only hosting`** for Firebase.
4. For API behavior, edit **`functions/index.js`** (ops routes) or **`functions/opsInsights.js`**, then **`firebase deploy --only functions:api`**.

## Endpoints the dashboard calls

| Action | Method | Path |
|--------|--------|------|
| Ops JSON | GET | `/api/ops/dashboard` |
| AI / rule insights | GET | `/api/ops/insights` |
| **Dashboard AI** (step-by-step help) | POST | `/api/ops/dashboard-guide` body `{ "message": "…" }` |
| Universal pick pool | GET | `/api/ops/universal-pool` |
| Save picks to Bruce/Giap board | POST | `/api/ops/curator-board/select` |
| Append deduped rows from live props | POST | `/api/ops/board/append-legs` body `{ "curatorId": "bruce"|"giap", "rows": [...] }` |
| Stripe price IDs configured | GET | `/api/billing/pricing-status` (unauthenticated summary) |

All ops JSON routes require **`X-Ops-Pin`** or owner Bearer token. Wrong PINs and bad auth attempts are **rate-limited per IP** in Firestore (`_opsAuthRate`) after repeated failures (default **12** failures per **15 minutes**); successful unlock clears the counter for that IP.

**GitHub Pages** (`github.io`): the desk uses **production Cloud Run** when **API base** is left empty (same origin as `https://api-lifnvql5aa-uc.a.run.app` in code). Override **API base** only for staging. The page sends **`X-Ops-Pin`** on every request.

## Curators (Bruce + Giap only)

See **`docs/CURATOR_ACCOUNTS.md`** (logins, ops pool tab, Stripe). Env checklist: **`scripts/setup-curators-auth.md`**.
