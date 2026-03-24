# Publish, internal QA, and user testing

Use this flow whenever you ship backend changes, cut an iOS build, or onboard testers.

---

## 1. Backend (Firebase) — before every release

| Step | Action |
|------|--------|
| Login | `firebase login` (once per machine) |
| Project | Confirm `.firebaserc` → `hit-a-lick-database` |
| Secrets | Stripe + Odds + RapidAPI keys set per [DEPLOY_RUNBOOK.md](./DEPLOY_RUNBOOK.md) |
| Verify locally | From repo root: `npm run verify:functions` |
| Deploy | `npm run deploy:backend` *(or `firebase deploy --only functions,hosting`)* |
| Smoke | `npm run smoke` *(uses prod URL; set `HITALICK_API_BASE` for another env)* |

**URLs after deploy**

- API (Cloud Run): see Firebase Console → Functions → `api` → URL, or run `firebase functions:log` after hitting `/health`.
- Hosting: `https://hit-a-lick-database.web.app` (and custom domain if configured).
- Ops JSON: `https://hit-a-lick-database.web.app/ops` or `GET …/ops/dashboard` on the API.

---

## 2. iOS — Archive & TestFlight

1. Open `HitALick.xcodeproj` in Xcode (latest stable Xcode).
2. **Signing**: Team + automatic signing for the Hit-A-Lick target.
3. **Scheme**: `Release` for TestFlight/App Store.
4. **API URL (internal testers)**:
   - **Debug builds**: **Account** tab → **Developer — API base URL** (save staging URL or **Reset** for production).
   - **Release / TestFlight**: always production unless you add a separate internal build with a custom URL (UserDefaults key `hitalick_api_base` is still read if set by MDM/config profile—rare).
5. **App Check**:
   - `FirebaseAppCheckDebugToken` was **removed** from `Info.plist` (no hardcoded debug token in shipping plist).
   - `HitALickApp.swift` registers App Check **before** `FirebaseApp.configure()`: **Debug** + **simulator** → debug provider; **Release on device** → `AppAttestProvider`.
   - `HitALick.entitlements` includes **App Attest** (`com.apple.developer.devicecheck.appattest-environment` = `production`). In Xcode: **Signing & Capabilities** → confirm **App Attest** is enabled (add if missing); in [Apple Developer](https://developer.apple.com) ensure the App ID has App Attest.
   - In [Firebase Console](https://console.firebase.google.com) → **App Check** → register the iOS app with the **App Attest** provider; for Debug/simulator, register **debug tokens** from the Xcode console ([debug provider doc](https://firebase.google.com/docs/app-check/ios/debug-provider)).
6. **Push (optional for this release)**: `aps-environment` is currently `development` in `HitALick.entitlements`. For **TestFlight/App Store** distribution with production APNs, switch to `production` (or let Xcode manage via capability) when you ship push to users.
7. **Archive**: Product → Archive → Distribute App → App Store Connect → TestFlight.
8. **Internal testing**: Add internal testers (App Store Connect → Users and Access → Sandbox / TestFlight groups).
9. **External testing**: Create an External Test group, submit for Beta App Review if required.

**Compliance**: See [APP_STORE_COMPLIANCE_CHECKLIST.md](./APP_STORE_COMPLIANCE_CHECKLIST.md).

---

## 3. What internal team should regression-test

| Area | Checks |
|------|--------|
| Auth | Sign in (email / Google); session persists after relaunch |
| API | Home / props load; no blank Elite Desk after pull-to-refresh |
| Elite | Board sync (if logged in); bootstrap loads |
| Billing | Entitlement reflects Stripe test user (server truth) |
| Push | Device registers; alerts only if FCM/APNs configured |
| Web | `site/app.html` loads against API; `/ops` dashboard renders |

---

## 4. What beta users should try (short script)

1. Install from TestFlight.
2. Sign in.
3. Open **Elite Desk** (or main props flow) — confirm data loads.
4. Change sport filter — list updates.
5. Pull to refresh — no crash; error message if offline is OK.

Collect feedback in one place (Slack, Notion, or GitHub Issues).

---

## 5. Feature updates (ongoing)

1. Merge or commit changes on your main branch.
2. `npm run verify:functions` → `npm run deploy:backend` → `npm run smoke`.
3. Bump iOS **build number** (and version if needed); archive and upload.
4. Update [CHANGELOG.md](./CHANGELOG.md) with user-visible notes.

---

## 6. Optional: local emulators

```bash
npm run emulators
```

Requires Firebase emulators installed (`firebase init emulators` once). Use for API shape testing without touching production.

---

## 7. Troubleshooting

| Symptom | Likely fix |
|---------|------------|
| `verify:functions` fails | Fix import/syntax in `functions/`; run `cd functions && npm install` |
| Smoke returns non-2xx | Redeploy functions; check secrets; see Cloud Run logs |
| iOS “Live feed unavailable” | API down, wrong `APIConfig` URL, or auth token issue |
| Empty props | Odds API quota / keys; check `/api/status` and ops dashboard |
