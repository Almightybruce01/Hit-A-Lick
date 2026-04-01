# Hit-A-Lick Cloud Functions

## Layout (Node 22 + **ESM**)

- **`package.json`** sets `"type": "module"` — all first-party `.js` files use **`import` / `export`**.
- **`index.js`** — Express `api` (`onRequest`), Stripe webhook, re-exports scheduled jobs.
- **`sportsdataapi/*.js`** — Route `handler` exports + **scheduled** wrappers (`cacheLiveGame`, `scrapeTeams`, …).

## Deploy

```bash
cd functions && npm install && cd .. && firebase deploy --only functions
```

**Hosting + API (website checkout):**

```bash
firebase deploy --only hosting,functions:api,functions:stripeWebhook
```

**Stripe keys vs `functions/.env`:** do **not** put `STRIPE_SECRET_KEY` or `STRIPE_PRICE_*` in `functions/.env` — Firebase CLI merges that file into Cloud Run as **plain** env vars and they **collide** with Secret Manager. Use `functions/.env.stripe.local` (gitignored; see `.env.stripe.example`) for local Stripe scripts, and push to Secret Manager:

`bash scripts/push-hitalick-firebase-secrets-from-env.sh`

The `api` and `stripeWebhook` functions only declare the Hit-A-Lick catalog secret names in `index.js` (`STRIPE_PRICE_REGULAR_MONTHLY`, bundle/add-on, Bruce, Giap, AI credits).

Deploy includes **`publishDailyAiPlays`** (Cloud Scheduler: **6:00** daily in `AI_PLAYS_TZ`, default `America/New_York`). It writes `systemSettings/aiPlaysDaily` and idempotently posts the Bruce feed card for that calendar day. Clients read the snapshot via **`GET /api/ai/plays-of-day`**.

### Stripe catalog (Hit-A-Lick only)

Checkout tiers in `billing.js`: **`regular`** (app + 50 AI/mo), **`premium`** (bundle for new members or AI add-on after Regular), **`bruce`** / **`giap`** (separate curator feeds — no combined SKU), plus one-time **`create-ai-credits-session`** (`STRIPE_PRICE_AI_CREDITS_50`).

**Bootstrap new prices + `HITALICK25` (25% off Regular + Premium only):** from repo root, with Functions deps installed (`cd functions && npm install`):

`STRIPE_SECRET_KEY=sk_live_xxx node scripts/stripe_hit_a_lick_catalog.js`

That script **archives only** Stripe products whose metadata is `app=hit_a_lick`, then creates fresh products/prices. The coupon’s `applies_to.products` lists **Regular**, **Premium bundle**, and **Premium AI add-on** — not Bruce/Giap picks and not AI credit packs.

**One-time 25% (first invoice only), four single-use promotion codes** for Regular/Premium products (works whether the customer picks monthly or yearly prices on those products):

`STRIPE_SECRET_KEY=sk_live_xxx node scripts/stripe_hit_a_lick_onetime_promos.cjs`

Default codes printed: `HL1REGM`, `HL1REGY`, `HL1PRMM`, `HL1PRMY` (each `max_redemptions: 1`). Share privately; re-run with edited code strings in the script if a code was already created in Stripe.

**Retiring old Hit-A-Lick catalog manually:** in the Stripe Dashboard, filter by product name/metadata for this app and **Archive** — never bulk-delete another app’s products.

## Device sessions

- **`HITALICK_MAX_DEVICES`** — concurrent browsers/apps per paying uid (default **2**, min **1**, max **5**). Staff emails in `deviceSessions.js` bypass the cap.
- **`HITALICK_DEVICE_STALE_DAYS`** — drop slot rows not seen in this many days (default **45**) so old devices do not block new logins forever.

## Env

Set secrets / config in Firebase Console → Functions → Configuration (e.g. `ODDS_API_KEY`, `ODDS_PROP_MARKET_TIER`, RapidAPI keys).

## Runtime

- **`firebase-functions` v7** — HTTPS + scheduled functions use the v2 API from `firebase-functions/v2`.
- **Express** — `trust proxy` is enabled for correct client IP behind Cloud Run; JSON body limit `512kb`; unknown routes return `404` JSON.
- **ESM** — `package.json` has `"type": "module"`; first-party routers (`billing.js`, `elite.js`, …) use `import`/`export` consistently.
