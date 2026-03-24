# Hit-A-Lick Cloud Functions

## Layout (Node 22 + **ESM**)

- **`package.json`** sets `"type": "module"` — all first-party `.js` files use **`import` / `export`**.
- **`index.js`** — Express `api` (`onRequest`), Stripe webhook, re-exports scheduled jobs.
- **`sportsdataapi/*.js`** — Route `handler` exports + **scheduled** wrappers (`cacheLiveGame`, `scrapeTeams`, …).

## Deploy

```bash
cd functions && npm install && cd .. && firebase deploy --only functions
```

## Env

Set secrets / config in Firebase Console → Functions → Configuration (e.g. `ODDS_API_KEY`, `ODDS_PROP_MARKET_TIER`, RapidAPI keys).

## Runtime

- **`firebase-functions` v7** — HTTPS + scheduled functions use the v2 API from `firebase-functions/v2`.
- **Express** — `trust proxy` is enabled for correct client IP behind Cloud Run; JSON body limit `512kb`; unknown routes return `404` JSON.
- **ESM** — `package.json` has `"type": "module"`; first-party routers (`billing.js`, `elite.js`, …) use `import`/`export` consistently.
