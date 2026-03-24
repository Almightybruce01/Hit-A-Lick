# Ops dashboard — where it lives, how to use it, GitHub

## Live links (GitHub Pages + repo)

| What | URL |
|------|-----|
| **GitHub repository** (same tree as your Desktop `Hit-A-Lick` folder — dashboard source is **`site/`**) | [github.com/Almightybruce01/Hit-A-Lick](https://github.com/Almightybruce01/Hit-A-Lick) |
| **Ops desk (direct)** | [almightybruce01.github.io/Hit-A-Lick/ops-dashboard.html](https://almightybruce01.github.io/Hit-A-Lick/ops-dashboard.html) |
| **Short path** (`/ops/` → same desk) | [almightybruce01.github.io/Hit-A-Lick/ops/](https://almightybruce01.github.io/Hit-A-Lick/ops/) |

Deployments run on every push to **`main`** via **`.github/workflows/pages.yml`** (GitHub Actions → Pages).

### Custom domain / 404 on `investli.org`

If `github.io` **redirects** to **`investli.org/Hit-A-Lick/...`** and you get **404**, your domain’s **DNS is not pointing at GitHub Pages** (often it points to Vercel or another host). Fix it in your DNS provider using [GitHub’s custom-domain docs](https://docs.github.com/en/pages/configuring-a-custom-domain-for-your-github-pages-site/managing-a-custom-domain-for-your-github-pages-site), **or** remove the custom domain in **GitHub → Settings → Pages** so **`github.io`** URLs load without that redirect.

## On your Mac (Desktop / repo)

Canonical file in the project:

**`site/ops-dashboard.html`**

### Desktop shortcut (unique name)

On your Mac Desktop there is a **symlink** you can double-click:

**`HitALick-OpsControl-PublicDashboard-PIN5505.html`**

Full path:

`/Users/brianbruce/Desktop/HitALick-OpsControl-PublicDashboard-PIN5505.html`

It points at `Hit-A-Lick/site/ops-dashboard.html`. If you move the repo, recreate the link:

```bash
bash /Users/brianbruce/Desktop/Hit-A-Lick/scripts/link-ops-dashboard-desktop.sh
```

Companion note file (same folder):

**`HitALick-OpsControl-Desktop-README.txt`**

Open the dashboard **in the browser** — for full API use, deploy with Firebase Hosting or GitHub Pages so API calls work (CORS / same-origin).

## Deployed URL (Firebase — recommended for API same-origin)

After `firebase deploy --only hosting`, your site serves:

- **`https://<your-project>.web.app/ops`** → rewrites to `ops-dashboard.html` (see `firebase.json`).

Bookmark **`/ops`** on your phone/desktop — that is the “saved dashboard” link that talks to **`/api/**`** on the same host.

## PIN (5505)

The API accepts:

- Header **`X-Ops-Pin: 5505`** (default; override with Firebase secret **`OPS_DASHBOARD_PIN`**),

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
| Stripe price IDs configured | GET | `/api/billing/pricing-status` (unauthenticated summary) |

All ops JSON routes require **`X-Ops-Pin`** or owner Bearer token.

**GitHub Pages** is on **`github.io`** — API calls are **cross-origin** to your Cloud Run / Firebase API. In the dashboard, set **API base URL** (top of page) to your production API origin, e.g. `https://api-xxxxx-uc.a.run.app` **without** trailing slash. The page sends **`X-Ops-Pin`** on every request.

## Curator owners (Mike, Giap, Bruce, Toriano)

Firebase **does not** auto-create users from this repo. Create four users in **Firebase Console → Authentication**, then set secrets **`CURATOR_*_EMAIL`** to match. See **`scripts/setup-curators-auth.md`**.
