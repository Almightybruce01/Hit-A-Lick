# Hit-A-Lick — Bruce & Giap (copy/paste)

**Curators:** Bruce + Giap only.

**Passwords:** Real sign-in passwords are **never** stored in this repo or in chat. They exist only in **Firebase Authentication** (you choose them or reset them in Console). Ops PIN `2012` is **not** your Firebase password — it only unlocks the **ops desk** when `OPS_DASHBOARD_PIN` is unset.

**Live site:** `https://hit-a-lick-database.web.app`  
**Mirror (GitHub Pages):** `https://almightybruce01.github.io/Hit-A-Lick`  
**API:** `https://api-lifnvql5aa-uc.a.run.app`

---

## PANE — Delete / remake Firebase logins (optional)

```
Do this in Firebase Console → Authentication (not in git):

1) Open: https://console.firebase.google.com → your project → Authentication → Users.

2) To reset without deleting: user row → ⋮ → Reset password (email link) OR set a new password if your project allows.

3) To fully delete and recreate:
   - Delete user brucebrian50@gmail.com (if listed).
   - Add user → email brucebrian50@gmail.com → choose a NEW strong password → save.
   - Repeat for giap.social1@gmail.com with a different strong password.

4) After recreate: sign in again on https://hit-a-lick-database.web.app/account.html

Optional script (local machine, service account JSON — never commit):
  cp scripts/curator-accounts.example.json scripts/curator-accounts.json
  # edit emails/passwords in curator-accounts.json
  export GOOGLE_APPLICATION_CREDENTIALS=/path/to/serviceAccount.json
  node scripts/create-curator-firebase-users.cjs
```

---

## ALL-IN-ONE — Bruce (copy block)

```
========== BRUCE — EVERYTHING IN ONE PLACE ==========

YOUR EMAIL (Firebase login):
  brucebrian50@gmail.com
YOUR PASSWORD:
  (whatever you set in Firebase Console → Authentication — not stored in git)

OPS DESK PIN (unlock ops-dashboard — same PIN for you and Giap):
  2012  ← default if Firebase secret OPS_DASHBOARD_PIN is NOT set
  If you set OPS_DASHBOARD_PIN in production, use THAT value instead of 2012.

LINKS (use Firebase site first; GitHub is a mirror):
  Account / sign up:     https://hit-a-lick-database.web.app/account.html
  Web app:               https://hit-a-lick-database.web.app/app.html
  Pricing / Stripe:      https://hit-a-lick-database.web.app/pricing.html
  Ops desk (PIN above):  https://hit-a-lick-database.web.app/ops-dashboard.html
  Mirror (GitHub Pages): https://almightybruce01.github.io/Hit-A-Lick/…

POST PICKS — WEB APP (you):
  1) Open web app link above.
  2) Sign in with brucebrian50@gmail.com.
  3) Account → Curator Studio (web).
  4) Lane: Bruce (or Premium board if you use it).
  5) Load universal pool → select rows → Save to board.

POST PICKS — OPS DESK (optional):
  1) Open ops desk link → enter PIN (2012 or your OPS_DASHBOARD_PIN).
  2) Leave API base empty.
  3) Tab “Curator pool” → Load pool → lane Bruce or Giap → Save to board.
     Or “Props (3 days)” → append legs.

API (optional, Bruce board):
  POST https://api-lifnvql5aa-uc.a.run.app/api/picks/bruce
  Header: Authorization: Bearer <your Firebase ID token>
  JSON: headline, hitRateClaim (optional), items[{ title, league, pick, notes, confidence, gameDate }]

iOS: Subscriptions only on website — Account tab → “Open pricing” / “Open account” goes to the same URLs.
====================================================
```

---

## ALL-IN-ONE — Giap (copy block)

```
========== GIAP — EVERYTHING IN ONE PLACE ==========

GIAP EMAIL (Firebase login):
  giap.social1@gmail.com
GIAP PASSWORD:
  (set in Firebase Console → Authentication — share privately with Giap, not in git)

OPS DESK PIN (if Bruce lets Giap use the desk — same PIN as Bruce):
  2012  ← default if OPS_DASHBOARD_PIN secret is not set on the server
  Otherwise use whatever Bruce set as OPS_DASHBOARD_PIN.

LINKS:
  Account / sign up:     https://hit-a-lick-database.web.app/account.html
  Web app:               https://hit-a-lick-database.web.app/app.html
  Pricing (fans / subs): https://hit-a-lick-database.web.app/pricing.html
  Ops desk (optional):   https://hit-a-lick-database.web.app/ops-dashboard.html

POST PICKS — WEB APP (Giap — Giap lane only):
  1) Open web app link above.
  2) Sign in with giap.social1@gmail.com.
  3) Account → Curator Studio (web).
  4) Lane: Giap only.
  5) Load universal pool → select rows → Save to board.

POST PICKS — OPS DESK (only if Bruce shared the PIN):
  1) Open ops desk → enter same PIN as Bruce (2012 or OPS_DASHBOARD_PIN).
  2) Leave API base empty.
  3) Curator pool → lane “Giap Pick's” → Save to board.

API (optional, Giap board):
  POST https://api-lifnvql5aa-uc.a.run.app/api/picks/giap
  Header: Authorization: Bearer <Giap Firebase ID token>
  Same JSON shape as Bruce board.

Server must know Giap’s email (Functions): CURATOR_GIAP_EMAIL=giap.social1@gmail.com
====================================================
```

---

## COPY — Bruce: log in

```
Site (account): https://hit-a-lick-database.web.app/account.html
Mirror:          https://almightybruce01.github.io/Hit-A-Lick/account.html

Email:    brucebrian50@gmail.com
Password: (the password you set in Firebase Console → Authentication)
```

---

## COPY — Bruce: post picks (web app)

```
1) Open: https://hit-a-lick-database.web.app/app.html
   (mirror: https://almightybruce01.github.io/Hit-A-Lick/app.html)

2) Sign in with brucebrian50@gmail.com (Account tab if needed).

3) Account → Curator Studio (web)

4) Lane: Bruce (or Premium board if you use that tier)

5) Load universal pool → select rows → Save to board
```

**Direct API (optional):**

```
POST https://api-lifnvql5aa-uc.a.run.app/api/picks/bruce
Authorization: Bearer <Bruce Firebase ID token>
Content-Type: application/json
```

Body: JSON with `headline`, optional `hitRateClaim`, `items[]` (each: `title`, `league`, `pick`, `notes`, `confidence`, `gameDate`).

**Owner-only board:** `POST https://api-lifnvql5aa-uc.a.run.app/api/picks/current-bets/save` (Bruce token only).

---

## COPY — Bruce: ops desk (optional)

```
URL:  https://hit-a-lick-database.web.app/ops-dashboard.html
      (mirror: https://almightybruce01.github.io/Hit-A-Lick/ops-dashboard.html)

PIN:  Firebase secret OPS_DASHBOARD_PIN (if unset, server default is 2012 — use a strong PIN in production)

API:  On github.io leave "API base" EMPTY (desk uses Cloud Run automatically).
      On hit-a-lick-database.web.app leave API base empty (same-origin /api).
```

Tabs: **Curator pool** (load pool → lane → save) or **Props (3 days)** → append legs.

---

## COPY — Giap: log in

```
Site (account): https://hit-a-lick-database.web.app/account.html
Mirror:          https://almightybruce01.github.io/Hit-A-Lick/account.html

Email:    giap.social1@gmail.com
Password: (the password set in Firebase Authentication)
```

**Server:** `CURATOR_GIAP_EMAIL=giap.social1@gmail.com` (Firebase Functions secret / config, lowercase).

---

## COPY — Giap: post picks (web app)

```
1) Open: https://hit-a-lick-database.web.app/app.html
   (mirror: https://almightybruce01.github.io/Hit-A-Lick/app.html)

2) Sign in with giap.social1@gmail.com.

3) Account → Curator Studio (web)

4) Lane: Giap only (Giap cannot edit Bruce’s lane from the app)

5) Load universal pool → select rows → Save to board
```

**Direct API (optional):**

```
POST https://api-lifnvql5aa-uc.a.run.app/api/picks/giap
Authorization: Bearer <Giap Firebase ID token>
Content-Type: application/json
```

Same JSON shape as Bruce. Bruce (owner) can POST Giap’s path too if needed.

---

## COPY — Custom domain (if you use Firebase on hitalick.org)

```
https://www.hitalick.org/account.html
https://www.hitalick.org/app.html
https://www.hitalick.org/ops-dashboard.html
```

---

## Triple-check: ops dashboard is the right site (active)

1. Open: `https://almightybruce01.github.io/Hit-A-Lick/ops-dashboard.html`  
2. **Browser tab title** must be **Hit-A-Lick · Ops Desk**.  
3. **URL** must contain **`almightybruce01.github.io/Hit-A-Lick/`** (or your **`hitalick.org`** deploy of the same `site/ops-dashboard.html` from this repo).  
4. Lock screen should link to **`github.com/Almightybruce01/Hit-A-Lick`**.  
5. If the path shows **another repo name** or **another product**, you are on the wrong host — fix the bookmark or GitHub Pages source branch.

This codebase does **not** configure any other product’s dashboard; wrong URLs are always bookmarks, custom domains, or an old Desktop shortcut. Run `bash scripts/install-live-dashboard-desktop.sh` for **`Hit-A-Lick-Ops-Desk.webloc`**.

---

## Stripe: only new Hit-A-Lick catalog (checkout)

- The **website and Functions** do **not** embed old product IDs. Checkout uses **only** these env vars:  
  `STRIPE_PRICE_REGULAR_MONTHLY`, `STRIPE_PRICE_PREMIUM_BUNDLE_MONTHLY`, `STRIPE_PRICE_PREMIUM_AI_ADDON_MONTHLY`, `STRIPE_PRICE_BRUCE_PICKS_MONTHLY`, `STRIPE_PRICE_GIAP_PICKS_MONTHLY`, `STRIPE_PRICE_AI_CREDITS_50`.
- Those **`price_...` IDs** must belong to Stripe products with metadata **`app=hit_a_lick`** (created by `scripts/stripe_hit_a_lick_catalog.js`). Product names look like **Hit-A-Lick Regular**, **Hit-A-Lick Bruce Picks**, etc.
- **Do not** set secrets to legacy rows in the same Stripe account (e.g. unnamed **Core Membership**, old **Bruce** products without that metadata). In **Stripe Dashboard**, **archive** unused duplicates so customers only see the Hit-A-Lick–named active products.
- After changing secrets: `firebase deploy --only functions` (or your usual deploy).

**Ops desk check:** unlock → tab that shows Stripe / env (or `GET /api/billing/pricing-status` with auth) to confirm price env vars are set.

---

## Device limits (subscribers only; not Bruce/Giap staff)

- `HITALICK_MAX_DEVICES` default **2** (range 1–5). Stale slots drop after `HITALICK_DEVICE_STALE_DAYS` (default **45**).  
- **Account** page → clear device slots if someone is locked out.

---

## Public promos

- **`HITALICK25`** — repeating 25% on Regular + Premium lines (Stripe promotion code).  
- **HL1REGM / HL1REGY / HL1PRMM / HL1PRMY** — one redemption each if you created them (`scripts/stripe_hit_a_lick_onetime_promos.cjs`).

---

## Firestore picks documents

Collection **`contentPicks`**: `bruce_picks`, `bruce_premium_picks`, `giap_picks`, `current_bets`.

---

## GET picks (subscriber test)

```
GET https://<YOUR_API_ORIGIN>/api/picks/bruce?uid=<their_uid>
Authorization: Bearer <their Firebase ID token>
```

Requires app subscription + Bruce picks add-on for non-staff (see `functions/picks.js`).
