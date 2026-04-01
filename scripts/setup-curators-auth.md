# Curator Firebase Auth + Stripe (one-time)

Full step-by-step for **Bruce + Giap** lanes: **`docs/CURATOR_ACCOUNTS.md`**.

## 1) Create curator users in Firebase Auth

In [Firebase Console](https://console.firebase.google.com) → Authentication → Add user:

- Use the **same emails** you set in Functions env: `OWNER_EMAIL` (Bruce / owner) and `CURATOR_GIAP_EMAIL` (Giap). Optional: `CURATOR_BRUCE_EMAIL` if the Bruce picks lane should not be the owner account.

Or CLI (requires Firebase CLI logged in):

```bash
firebase auth:import curators-users.json --hash-algo=SCRYPT --hash-key=... 
```

(Prefer Console for small teams.)

## 2) Set Functions secrets / env

```bash
firebase functions:secrets:set OWNER_EMAIL
firebase functions:secrets:set CURATOR_GIAP_EMAIL
# optional if Bruce picks lane is not the owner account:
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
```

4. Verify resolution (no auth required):

`GET https://<your-api-host>/api/billing/pricing-status`

Checkout body field `tier` must be one of: `regular`, `premium`, `bruce`, `giap` (see `billing.js` `create-checkout-session`).

## 4) Deploy

```bash
firebase deploy --only functions:api
```
