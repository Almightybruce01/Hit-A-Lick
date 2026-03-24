# Bruce + Giap curator logins (two lanes only)

**Bruce** (`brucebrian50@gmail.com`) is **main admin**: Firebase `OWNER_EMAIL`, universal pick pool, ops desk PIN, all curator studios, full entitlements in-app when signed in.

**Giap** (`giap.social1@gmail.com`) is **co-curator**: only the **Giap** lane in Curator Studio and API; gets **complimentary** Premium-tier + **unlimited AI** when that exact email signs in (see `mergeStaffEntitlement` in `functions/billing.js` and AI gate in `functions/ai.js`). Fans still **pay Stripe** to view Giap’s board unless they’re staff.

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
- Desktop shortcut (run once): `bash scripts/install-live-dashboard-desktop.sh` → **`HitALick-Live-Ops-Dashboard.webloc`** on your Desktop.

## AI Lab

- **5 free** AI pick/copilot requests per calendar month for normal logged-in users (see `functions/ai.js`).  
- **Unlimited** for Bruce, Giap (staff emails), or anyone with an active paid curator/premium entitlement.  
- Interactions logged to Firestore `aiInteractionLog` for future training.  
- Full historical modeling (every player split, injury graphs, etc.) is staged behind the same logging + `dataRetention` schedules — extend as you add collectors.
