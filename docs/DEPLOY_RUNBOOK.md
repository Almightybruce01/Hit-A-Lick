# HitALick Deploy Runbook

> **End-to-end publish & QA:** see [PUBLISH_AND_TEST.md](./PUBLISH_AND_TEST.md) (scripts: `npm run deploy:backend`, `npm run smoke`).

## 1) Install/verify CLI tooling
```bash
firebase --version
node --version
npm --version
```

## 2) Configure Stripe secrets
Set functions environment variables (replace placeholders):
```bash
firebase functions:secrets:set STRIPE_SECRET_KEY
firebase functions:secrets:set STRIPE_WEBHOOK_SECRET
firebase functions:secrets:set STRIPE_PRICE_BRUCE_MONTHLY
firebase functions:secrets:set STRIPE_PRICE_BRUCE_ANNUAL
firebase functions:secrets:set STRIPE_PRICE_BRUCE_ELITE_VIP
firebase functions:secrets:set APP_SUCCESS_URL
firebase functions:secrets:set APP_CANCEL_URL
```

## 2b) Configure odds provider secrets (FanDuel + major books)
Set sportsbook feed configuration:
```bash
firebase functions:secrets:set ODDS_API_KEY
firebase functions:secrets:set ODDS_API_BOOKMAKERS
```
Recommended `ODDS_API_BOOKMAKERS` (retail + DFS top picks):
`fanduel,draftkings,prizepicks,underdog`

The Odds API lists **PrizePicks** and **Underdog** under region `us_dfs`. If any configured book uses DFS keys, the backend defaults to **`regions=us,us_dfs`** for Odds API calls. Override with optional secret/env `ODDS_API_REGIONS` (e.g. `us` only) if you need to limit DFS traffic.

Optional:
- `ODDS_API_EVENT_PROP_LIMIT` (default 10)
- `ODDS_API_PROP_CONCURRENCY` (default 4)
- `ODDS_API_REGIONS` (default auto: `us` or `us,us_dfs`)
- `ODDS_API_FLAT_PACE_FROM_DAY` — from this UTC calendar day onward, allow the full computed daily Odds API allowance immediately (no intraday ramp). Monthly quota still resets with The Odds API (**1st of month 00:00 UTC**).
- `ODDS_API_DAILY_BURST_MULTIPLIER` — multiplies the “remaining ÷ days left” daily target (default 1.35). Catch-up when behind pace is also applied in `requestBudget.js`.

## 2c) Curator emails + Stripe curator prices
See [`MARKETING_CURATORS.md`](./MARKETING_CURATORS.md). Set Firebase Auth accounts for each curator and configure:
```bash
firebase functions:secrets:set STRIPE_PRICE_CURATOR_GIAP
firebase functions:secrets:set STRIPE_PRICE_CURATOR_BRUCE
firebase functions:secrets:set STRIPE_PRICE_CURATOR_MIKE
firebase functions:secrets:set STRIPE_PRICE_CURATOR_TORIANO
firebase functions:secrets:set STRIPE_PRICE_ALL_CURATORS
```
Env keys: `CURATOR_GIAP_EMAIL`, `CURATOR_BRUCE_EMAIL` (optional), `CURATOR_MIKE_EMAIL`, `CURATOR_TORIANO_EMAIL` (see `functions/curators.js`).

## 3) Deploy functions + hosting
From repo root:
```bash
firebase deploy --only functions,hosting
```

Fast path (API + site only):
```bash
firebase deploy --only functions:api,hosting
```

## 4) Wire Stripe webhook
In Stripe Dashboard:
- Add endpoint: `https://<your-cloud-function-url>/stripeWebhook`
- Subscribe to:
  - `customer.subscription.created`
  - `customer.subscription.updated`
  - `customer.subscription.deleted`
- Use generated webhook secret for `STRIPE_WEBHOOK_SECRET`.

## 5) Connect custom domain
In Firebase Hosting:
- Add custom domain: `hitalick.org`
- Add DNS records from Firebase to your domain registrar.
- Verify SSL issuance and propagation.

## 6) App entitlement integration
iOS app should check entitlement state after login:
- `GET /api/billing/entitlements/:uid`
- unlock `Bruce Picks` when `entitlement.active === true`
- unlock `Pro/Elite` features from `tier` for:
  - `GET /api/elite/bootstrap?uid=<uid>`
  - `POST /api/elite/state/save`
  - `POST /api/elite/alerts/evaluate`
  - `GET /api/elite/alerts/feed?uid=<uid>`
  - `POST /api/elite/session-feedback`

## 6b) Next-sprint cloud features now live
- **Push-alert pipeline (event-driven)**:
  - Scheduler function: `processEliteAlerts` (every 5 minutes)
  - Queue + dispatch: Firestore `notificationQueue` + Firebase Cloud Messaging
  - Manual endpoints still available: `/api/elite/alerts/evaluate` + `/api/elite/alerts/feed`
- **Persistent CLV timeline hooks**: CLV-ready snapshots are written in props analytics and exposed in UI edge rows.
- **CLV history API**:
  - `GET /api/elite/clv/history`
  - `POST /api/elite/clv/history/batch`
- **Cross-surface board sync**: web + iOS read/write via `/api/elite/bootstrap` and `/api/elite/state/save`.
- **Personalization feedback loop**: session behavior is persisted with `/api/elite/session-feedback`.
- **Ranking model v2 outcomes**:
  - `POST /api/elite/session-outcome`
  - `GET /api/elite/ranking/profile`
- **Push device registration**:
  - `POST /api/elite/devices/register`
  - `POST /api/elite/devices/unregister`

## 6d) FCM + APNs setup (required for real push)
1. In Firebase Console -> Project Settings -> Cloud Messaging:
   - Enable Cloud Messaging API if prompted.
2. Add Apple push key:
   - Upload APNs Auth Key (`.p8`), Team ID, Key ID, Bundle ID.
3. Ensure iOS app registers for notifications on launch.
4. Register client device tokens to API:
```bash
curl -X POST "https://api-lifnvql5aa-uc.a.run.app/api/elite/devices/register" \
  -H "Authorization: Bearer <FIREBASE_ID_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"uid":"<uid>","provider":"fcm","platform":"ios","token":"<FCM_DEVICE_TOKEN>"}'
```
5. Deploy scheduler + API:
```bash
firebase deploy --only functions:api,functions:processEliteAlerts,hosting
```

## 6c) Verify provider health + output
```bash
curl "https://api-lifnvql5aa-uc.a.run.app/api/status"
curl "https://api-lifnvql5aa-uc.a.run.app/api/props?sport=nba&windowDays=3"
curl "https://api-lifnvql5aa-uc.a.run.app/api/games?sport=nba"
```
- If `props.source` returns fallback and warning mentions quota, fix The Odds API plan limits first.
- Target is thousands of player props; low totals indicate provider constraints, not app logic.

## 7) Final compliance pass
- Confirm no purchase links/buttons inside iOS app.
- Confirm app copy is analytics/informational.
- Confirm no simulated betting flows or virtual wagering loops.

## External accounts required before launch
- Firebase project owner access (Hosting + Functions + Firestore).
- [The Odds API](https://the-odds-api.com/) account with sufficient quota.
- [Stripe](https://stripe.com/) account for memberships and webhook events.
- Apple Developer account (for iOS TestFlight/App Store distribution).
