# Curator Firebase Auth + Stripe (one-time)

## 1) Create four curator users in Firebase Auth

In [Firebase Console](https://console.firebase.google.com) → Authentication → Add user:

- Use the **same emails** you will set in Functions env: `CURATOR_GIAP_EMAIL`, `CURATOR_MIKE_EMAIL`, `CURATOR_TORIANO_EMAIL`, and optionally `CURATOR_BRUCE_EMAIL` (or rely on `OWNER_EMAIL` for Bruce).

Or CLI (requires Firebase CLI logged in):

```bash
firebase auth:import curators-users.json --hash-algo=SCRYPT --hash-key=... 
```

(Prefer Console for small teams.)

## 2) Set Functions secrets / env

```bash
firebase functions:secrets:set CURATOR_GIAP_EMAIL
firebase functions:secrets:set CURATOR_MIKE_EMAIL
firebase functions:secrets:set CURATOR_TORIANO_EMAIL
# optional if Bruce is not the owner account:
firebase functions:secrets:set CURATOR_BRUCE_EMAIL
```

Local emulator: copy `functions/.env.example` → `functions/.env` and fill emails (no secrets in git).

## 3) Stripe products

1. In Stripe Dashboard create **Products** (e.g. “Giap Picks Monthly”) and **Prices** (recurring monthly).
2. Copy each **Price ID** (`price_...`).
3. Set secrets (names must match `functions/billing.js`):

```bash
firebase functions:secrets:set STRIPE_PRICE_CURATOR_GIAP
firebase functions:secrets:set STRIPE_PRICE_CURATOR_BRUCE
firebase functions:secrets:set STRIPE_PRICE_CURATOR_MIKE
firebase functions:secrets:set STRIPE_PRICE_CURATOR_TORIANO
firebase functions:secrets:set STRIPE_PRICE_ALL_CURATORS
```

4. Verify resolution (no auth required):

`GET https://<your-api-host>/api/billing/pricing-status`

Checkout body field `tier` must be one of: `curator_giap`, `curator_bruce`, `curator_mike`, `curator_toriano`, `all_curators` (see `curatorMetaForTier` in `billing.js`).

## 4) Deploy

```bash
firebase deploy --only functions:api
```
