# Hit-A-Lick

Elite sports analytics: **iOS app** (`HitALick/`), **Firebase Cloud Functions** (`functions/`), **Firebase Hosting** (`site/`).

## Publish, test, ship

1. **Backend**: `npm run verify:functions` → `npm run deploy:backend` → `npm run smoke`  
2. **Docs**: [docs/PUBLISH_AND_TEST.md](docs/PUBLISH_AND_TEST.md) (full checklist), [docs/TESTER_QUICKSTART.md](docs/TESTER_QUICKSTART.md) (share with beta testers), [docs/DEPLOY_RUNBOOK.md](docs/DEPLOY_RUNBOOK.md) (secrets & Stripe).  
3. **iOS**: Archive in Xcode → TestFlight; track changes in [docs/CHANGELOG.md](docs/CHANGELOG.md).

## Quick links

| Surface | URL / path |
|--------|------------|
| Production API | `https://api-lifnvql5aa-uc.a.run.app` |
| Hosted site | `https://hit-a-lick-database.web.app` |
| Ops desk | `/ops` (Hosting) or `GET /ops/dashboard` on API |

## Backend

- **Node 22**, **ESM** (`functions/package.json` → `"type": "module"`).
- **One-command deploy** (functions + hosting): `npm run deploy:backend`
- **Smoke test** (after deploy): `npm run smoke` — optional `HITALICK_API_BASE` for non-prod URLs
- **Provider test** (Odds API, RapidAPI, ESPN, Firestore): `npm run provider-test` — see [docs/DATA_PROVIDER_PLAN.md](docs/DATA_PROVIDER_PLAN.md)
- **Local emulators** (optional): `npm run emulators`

## iOS

- Open `HitALick.xcodeproj` in Xcode.
- API base URL: default in `HitALick/APIConfig.swift`. **Debug**: Account → **Developer — API base URL**; or UserDefaults `hitalick_api_base`.
- App Check: App Attest entitlement in `HitALick.entitlements`; register app in Firebase **App Check** console before enforcing.

## Firebase project

`hit-a-lick-database` (see `.firebaserc`).
