# Changelog

All notable user-visible and release-facing changes are listed here. Update this when you ship TestFlight or production builds.

## [Unreleased]

### Added
- Root `package.json` scripts: `deploy:backend`, `smoke`, `verify:functions`, `emulators`.
- `docs/PUBLISH_AND_TEST.md`, `docs/TESTER_QUICKSTART.md` for release and QA.
- **Debug-only** Account screen: **Developer — API base URL** (override `hitalick_api_base` without Xcode).

### Changed
- **App Check**: provider factory runs **before** `FirebaseApp.configure()`; Release on device uses **App Attest**; removed plist `FirebaseAppCheckDebugToken`.
- `APIConfig`: `productionBaseURL`, `setBaseURLOverride` / `clearBaseURLOverride`.
- (Add more items per release.)

---

## Template for each release

```markdown
## [x.y.z] - YYYY-MM-DD

### Added
### Changed
### Fixed
### Notes for testers
- …
```
