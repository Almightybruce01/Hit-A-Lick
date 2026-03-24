# Four curator logins (Bruce, Giap, Mike, Toriano)

Each lane is a **real Firebase Authentication user**. That person signs into the **HitALick iOS app** with **email + password**. The API maps **email → lane** using Firebase Functions secrets (`CURATOR_*_EMAIL`). **Fans** only see that lane’s board in **Premium** after **Stripe** says they subscribed (Firestore `entitlement`).

| Lane (Premium tab) | Firebase **display name** (recommended) | Secret (must match Auth email exactly) | What they do in the app |
|--------------------|----------------------------------------|------------------------------------------|-------------------------|
| **Giap Pick’s** | `Giap Pick's` | `CURATOR_GIAP_EMAIL` | **Account → Curator Studio** — profile photo, background, hex theme, featured parlays; pool picks are assigned by owner workflow. |
| **Bruce Pick’s** | `Bruce Pick's` | `CURATOR_BRUCE_EMAIL` *(optional)* | Same. If **unset**, Bruce lane uses **`OWNER_EMAIL`** (one login for site owner + Bruce lane). |
| **Mike Pick’s** | `Mike Pick's` | `CURATOR_MIKE_EMAIL` | Same. |
| **Toriano Pick’s** | `Toriano Pick's` | `CURATOR_TORIANO_EMAIL` | Same. |

**Site owner** (`OWNER_EMAIL`, usually your main Gmail) still sees **all four** Curator Studio links in Account and can edit the universal pool in ops tools.

## Passwords

Passwords **never** go in git. Set them in Firebase Console when you create each user, or use the script below with a local JSON file.

## Easiest: one inbox, four logins (Gmail plus-addressing)

If you use Gmail, you can use **four different Firebase emails** that all deliver to one mailbox:

- `yourname+giap@gmail.com` → Giap lane  
- `yourname+bruce@gmail.com` → Bruce lane (or skip and use your owner email for Bruce)  
- `yourname+mike@gmail.com` → Mike lane  
- `yourname+toriano@gmail.com` → Toriano lane  

Create each as a **separate** user in Firebase Auth. Set Functions secrets to those **exact** strings.

## Step A — Create the four Auth users

**Option 1 — Firebase Console (simple)**  
Authentication → Add user → for each row in the table: email, password, display name as above.

**Option 2 — Script (batch)**  

1. `cp scripts/curator-accounts.example.json scripts/curator-accounts.json`  
2. Edit **real** emails, **strong** passwords, display names.  
3. Download a **service account** JSON (Project settings → Service accounts). Save as `scripts/serviceAccount.json` (**gitignored**) or set `GOOGLE_APPLICATION_CREDENTIALS`.  
4. From repo root: `cd functions && npm ci && cd .. && node scripts/create-curator-firebase-users.cjs`

## Step B — Functions secrets (production)

Values must equal the Auth emails **character-for-character** (lowercase).

```bash
firebase functions:secrets:set CURATOR_GIAP_EMAIL
firebase functions:secrets:set CURATOR_MIKE_EMAIL
firebase functions:secrets:set CURATOR_TORIANO_EMAIL
# Optional — only if Bruce is not the same as OWNER_EMAIL:
firebase functions:secrets:set CURATOR_BRUCE_EMAIL
```

Local emulator: `functions/.env` — see `functions/.env.example`.

Then:

```bash
firebase deploy --only functions:api
```

## Step C — Stripe (subscribers only)

Each curator sell flow uses a **price** id. Set secrets (names in `functions/billing.js`):

`STRIPE_PRICE_CURATOR_GIAP`, `STRIPE_PRICE_CURATOR_BRUCE`, `STRIPE_PRICE_CURATOR_MIKE`, `STRIPE_PRICE_CURATOR_TORIANO`, `STRIPE_PRICE_ALL_CURATORS`.

Check: `GET https://<api>/api/billing/pricing-status`

Checkout metadata uses tiers like `curator_giap` so a Giap sub **does not** unlock Mike.

## Step D — App behavior (subscription + customization)

- **Curators:** After login, **Account** loads `GET /api/curators/me`. If you’re mapped to a lane, **Curator Studio** opens **your** lane (profile, background, parlays). Owner sees **all four** studios.  
- **Fans:** **Premium** tab loads boards from `GET /api/curators/:slug/board` only if `entitlement` includes that slug (or all-access / premium tier). Otherwise preview / paywall behavior.

## GitHub + your Hit-A-Lick folder

- **Local folder:** `Desktop/Hit-A-Lick` (same files as Git).  
- **Repo:** [github.com/Almightybruce01/Hit-A-Lick](https://github.com/Almightybruce01/Hit-A-Lick)  
- **Ops dashboard (GitHub Pages only for this project):**  
  - [almightybruce01.github.io/Hit-A-Lick/ops-dashboard.html](https://almightybruce01.github.io/Hit-A-Lick/ops-dashboard.html)  
  - [almightybruce01.github.io/Hit-A-Lick/ops/](https://almightybruce01.github.io/Hit-A-Lick/ops/)  

Bookmark **`github.io`** links above. This repo does **not** configure any non-GitHub domain for Pages.
