# Ops dashboard — where it lives, how to use it, GitHub

## On your Mac (Desktop / repo)

Canonical file in the project:

**`site/ops-dashboard.html`**

### Desktop shortcut (unique name)

On your Mac Desktop there is a **symlink** you can double-click:

**`HitALick-OpsControl-PublicDashboard-PIN5505.html`**

Full path:

`/Users/brianbruce/Desktop/HitALick-OpsControl-PublicDashboard-PIN5505.html`

It points at `Hit-A-Lick/site/ops-dashboard.html`. If you move the repo, recreate the link (see `scripts/link-ops-dashboard-desktop.sh`).

Companion note file (same folder):

**`HitALick-OpsControl-Desktop-README.txt`**

Open the dashboard **in the browser** — for full API use, deploy with Firebase Hosting or GitHub Pages so API calls work (CORS / same-origin).

## Deployed URL (recommended)

After `firebase deploy --only hosting`, your site serves:

- **https://&lt;your-project&gt;.web.app/ops** → rewrites to `ops-dashboard.html` (see `firebase.json`).

Bookmark **`/ops`** on your phone/desktop — that is the “saved dashboard” link that talks to **`/api/**`** on the same host.

## PIN (5505)

The API accepts:

- Header **`X-Ops-Pin: 5505`** (default; override with Firebase secret **`OPS_DASHBOARD_PIN`**),

**or**

- **`Authorization: Bearer &lt;Firebase ID token&gt;`** for **`OWNER_EMAIL`** only.

The static page stores the PIN in **sessionStorage** after you unlock — it is **not** committed to GitHub. Change the live PIN with:

```bash
firebase functions:secrets:set OPS_DASHBOARD_PIN
```

Redeploy `api` after changing secrets.

## Public GitHub repo

1. Push this repo to GitHub (same project you use for Cursor).
2. Optional **GitHub Pages**: Settings → Pages → deploy from `main` / `site` folder (or copy `site/ops-dashboard.html` to `docs/` and enable Pages on `/docs`).
3. **Important:** GitHub Pages is on **`github.io`** — API calls are **cross-origin** to your Cloud Run / Firebase API. In the dashboard, set **API base URL** (top of page) to your production API origin, e.g. `https://api-xxxxx-uc.a.run.app` **without** trailing slash. The page sends `X-Ops-Pin` on every request.

## After using Cursor — improve the dashboard

1. Edit **`site/ops-dashboard.html`** (HTML/CSS/JS in one file).
2. Run **`firebase deploy --only hosting`** to publish.
3. For API behavior, edit **`functions/index.js`** (ops routes) or **`functions/opsInsights.js`**, then **`firebase deploy --only functions:api`**.

## Endpoints the dashboard calls

| Action | Method | Path |
|--------|--------|------|
| Ops JSON | GET | `/api/ops/dashboard` |
| AI / rule insights | GET | `/api/ops/insights` |
| Stripe price IDs configured | GET | `/api/billing/pricing-status` (unauthenticated summary) |

All ops JSON routes require **`X-Ops-Pin`** or owner Bearer token.

## Curator owners (Mike, Giap, Bruce, Toriano)

Firebase **does not** auto-create users from this repo. Create four users in **Firebase Console → Authentication**, then set secrets **`CURATOR_*_EMAIL`** to match. See **`scripts/setup-curators-auth.md`**.
