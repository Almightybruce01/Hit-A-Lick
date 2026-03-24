# Bruce + Giap curator logins (two lanes only)

## Sites to bookmark

| What | URL |
|------|-----|
| **Ops desk** (PIN, curator pool, **Props 3-day** tab) | [almightybruce01.github.io/Hit-A-Lick/ops-dashboard.html](https://almightybruce01.github.io/Hit-A-Lick/ops-dashboard.html) |
| **Web hub** (cards to ops, picks guide, pricing) | [almightybruce01.github.io/Hit-A-Lick/app-access.html](https://almightybruce01.github.io/Hit-A-Lick/app-access.html) |
| **Picks & staff steps** (this flow in one page) | [almightybruce01.github.io/Hit-A-Lick/curators-picks.html](https://almightybruce01.github.io/Hit-A-Lick/curators-picks.html) |
| **Elite web desk** (props + confidence UI; set API origin in page if needed) | [almightybruce01.github.io/Hit-A-Lick/app.html](https://almightybruce01.github.io/Hit-A-Lick/app.html) |
| **Pricing** | [almightybruce01.github.io/Hit-A-Lick/pricing.html](https://almightybruce01.github.io/Hit-A-Lick/pricing.html) |
| **GitHub** | [github.com/Almightybruce01/Hit-A-Lick](https://github.com/Almightybruce01/Hit-A-Lick) |

**iOS:** install your Hit-A-Lick build → sign in with Firebase → bottom tab **Picks** = Bruce & Giap boards. **Home → Open Props** = 3-day slate with AI confidence + leg odds.

---

## Exact steps to get picks live (subscribers see them)

### One-time setup (Bruce or dev)

1. **Firebase Authentication** — Create users:
   - `brucebrian50@gmail.com` (owner)
   - `giap.social1@gmail.com` (co-curator)  
   Set passwords in Firebase (examples below).  
2. **Functions secrets** — `OWNER_EMAIL`, `CURATOR_GIAP_EMAIL=giap.social1@gmail.com`, deploy `functions:api`.  
3. **Universal pool** — Picks must exist in the pool before boards show them. Add rows with **owner** tools (`POST /api/curators/pool/add` with Bruce’s Firebase **Bearer** token, or your internal scripts).  
4. **Stripe** — Prices for `curator_giap`, `curator_bruce`, `all_curators` so fans can subscribe.

### Bruce (main admin) — web ops desk

1. Open the live desk: [ops-dashboard.html](https://almightybruce01.github.io/Hit-A-Lick/ops-dashboard.html) or double-click **`Hit-A-Lick-Ops-Desk.webloc`** on your Desktop (run `bash scripts/install-live-dashboard-desktop.sh` once — file sits **directly on Desktop**, not inside a folder).  
2. Enter **PIN** (default **5505** unless `OPS_DASHBOARD_PIN` changed).  
3. Paste **API base URL** if you are on `github.io` (your Cloud Run or Firebase API origin, no trailing slash).  
4. Tab **Curator pool** → **Load pool** → check the rows → choose lane **Bruce Pick's** or **Giap Pick's** → **Save to board**.  
5. Optional: tab **Dashboard AI** — ask “how do I publish Bruce picks?” for numbered steps anytime.

### Bruce — iOS app

1. Sign in with **`brucebrian50@gmail.com`**.  
2. **Account → Curator Studio** — select **Bruce** or **Giap** lane and push picks from the pool (same data model as the web desk).

### Giap (co-curator)

1. Sign in with **`giap.social1@gmail.com`**.  
2. **Account → Curator Studio** — **Giap** lane only: choose picks from the universal pool and save.  
3. Giap does **not** have owner ops API access; if Bruce shares the **ops PIN**, Giap could use the web **Curator pool** the same way (optional).

### Subscribers (not admins)

- Pay via Stripe in the app → **Picks** tab (bottom bar) shows **Bruce** / **Giap** boards you published.

---

**Bruce** (`brucebrian50@gmail.com`) is **main admin**: Firebase `OWNER_EMAIL`, universal pick pool, ops desk PIN, all curator studios, full entitlements in-app when signed in.

**Giap** (`giap.social1@gmail.com`) is **co-curator**: in **Curator Studio** he only **edits** the **Giap** lane, but the API treats him like staff for **viewing**: **both boards**, **premium-tier features**, **unlimited AI**, and **stream center** when signed in with that email (`mergeStaffEntitlement` in `functions/billing.js` + board gate in `functions/curators.js`). Fans still **pay Stripe** to view boards unless they’re staff.

| Lane | Firebase display name (recommended) | Secret |
|------|----------------------------------------|--------|
| Bruce Pick’s | `Bruce Pick's` | `OWNER_EMAIL` (and optional `CURATOR_BRUCE_EMAIL` if Bruce lane ≠ owner) |
| Giap Pick’s | `Giap Pick's` | `CURATOR_GIAP_EMAIL` |

## Passwords (set in Firebase — not in git)

Use strong passwords when you create users. Example pattern you can set in **Firebase Console → Authentication** (change after first login):

- **Bruce:** `HitALick!Bruce2026`
- **Giap:** `HitALick!Giap2026`

## Create users

1. Firebase Console → Authentication → Add user for each email above.  
2. Or: `cp scripts/curator-accounts.example.json scripts/curator-accounts.json`, set passwords, add service account → `node scripts/create-curator-firebase-users.cjs` (see script header).

## Functions secrets (production)

```bash
firebase functions:secrets:set OWNER_EMAIL   # optional if already in config
firebase functions:secrets:set CURATOR_GIAP_EMAIL
firebase deploy --only functions:api
```

`CURATOR_GIAP_EMAIL` must be exactly `giap.social1@gmail.com` (lowercase).

## Where picks are chosen

- **Bruce (main):** **Ops desk** (`site/ops-dashboard.html` live on GitHub Pages) → tab **Curator pool**: load universal pool, check rows, choose **Bruce** or **Giap**, **Save to board** (calls `POST /api/ops/curator-board/select` with PIN). Also **iOS → Account → Curator Studio** per lane.  
- **Giap:** **iOS Curator Studio** for **Giap** only, and `POST /api/curators/giap/select` with pool IDs (same as app flow). Giap does **not** get ops pool tab unless you sign in as Bruce on the desk.

Pool rows are still created with **owner** tools (`POST /api/curators/pool/add` with owner Bearer).

## Stripe

Tiers: `curator_giap`, `curator_bruce`, `all_curators` (both lanes). Mike/Toriano removed from codebase.

## Repo / desktop / live ops link

- Project: `~/Desktop/Hit-A-Lick`  
- GitHub: `https://github.com/Almightybruce01/Hit-A-Lick`  
- Live ops: `https://almightybruce01.github.io/Hit-A-Lick/ops-dashboard.html`  
- Desktop shortcut (run once): `bash scripts/install-live-dashboard-desktop.sh` → **`Hit-A-Lick-Ops-Desk.webloc`** on your **Desktop root** (not inside a folder). Removes legacy `HitALick-Live-Ops-Dashboard.webloc` if present.

## AI Lab

- **5 free** AI pick/copilot requests per calendar month for normal logged-in users (see `functions/ai.js`).  
- **Unlimited** for Bruce, Giap (staff emails), or anyone with an active paid curator/premium entitlement.  
- Interactions logged to Firestore `aiInteractionLog` for future training.  
- Full historical modeling (every player split, injury graphs, etc.) is staged behind the same logging + `dataRetention` schedules — extend as you add collectors.
