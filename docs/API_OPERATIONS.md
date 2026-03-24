# Hit-A-Lick — API operations, quotas & UI lifecycle

This document explains **how many props/requests to plan for**, how the app **avoids burning quota**, and how **synthetic UI** behaves until live odds load.

---

## 1. Sports included

Default leagues: **NBA, NFL, MLB, WNBA** (`APP_SPORTS` in `functions/sportsdataapi/coverageTuning.js`).

Each league has different **typical priced player-prop depth** (planning reference only):

| Sport | Typical priced legs / event (ref) | Typical busy-day events (ref) |
|-------|-------------------------------------|-------------------------------|
| NBA   | ~22                                 | ~8                            |
| NFL   | ~28                                 | ~10                           |
| MLB   | ~16                                 | ~12                           |
| WNBA  | ~19                                 | ~3                            |

These numbers are **not** API guarantees — they are desk-planning anchors.

---

## 2. What drives Odds API cost?

Cost scales with:

1. **How often you poll** each sport (mitigated by `PROPS_LIVE_CACHE_TTL_SECONDS`).
2. **How many player-prop market batches** you request per event (`ODDS_PROP_MARKET_TIER`: `core` | `standard` | `full`).
3. **Per-event leg cap** (`recommendedEventPropLimit` in `coverageTuning.js`), influenced by `ODDS_API_PLAN_MODE` (`free` vs `paid`).

**Free / conservative mode** uses roughly **32%** of typical leg depth per event (capped), until you set `ODDS_API_PLAN_MODE=paid` on the backend.

---

## 3. Environment variables (Firebase Functions secrets)

Set via:

```bash
firebase functions:secrets:set ODDS_API_KEY
firebase functions:secrets:set RAPIDAPI_KEY
# ... etc.
```

| Variable | Purpose |
|----------|---------|
| `ODDS_API_KEY` | The Odds API (direct) |
| `ODDS_API_PLAN_MODE` | `free` (default) or `paid` — unlocks higher per-event leg caps in code paths |
| `ODDS_PROP_MARKET_TIER` | `core` / `standard` / `full` — batch depth |
| `ODDS_API_BOOKMAKERS` | Comma book keys, e.g. `fanduel,draftkings,betmgm` |
| `PROPS_LIVE_CACHE_TTL_SECONDS` | Live cache TTL; **45–90s** recommended for coalescing |
| `GAMES_LIVE_CACHE_TTL_SECONDS` | Games TTL (ESPN-backed) |
| `ENFORCE_BUDGET_GUARD` | `0` = monitor-only (default), `1` = enforce soft limits in `requestBudget.js` |
| `ODDS_API_DAILY_SOFT_LIMIT`, `RAPIDAPI_DAILY_SOFT_LIMIT` | Soft ceilings when enforce mode on |

---

## 4. Expected request volume (planning)

### With live cache (realistic)

If TTL ≈ **55s**, pulls per sport per day ≈ `86400 / 55` ≈ **1571** window checks — **but** the handler coalesces on cache hits, so **effective** live pulls are **~1 per TTL window per sport** for warm traffic.

The API response includes `coverage.quotaPlanning` with:

- `pullsPerSportPerDay`
- `totalPullsAllSportsPerDay`
- `realisticMonthlyWithLiveCache`
- `worstCaseMonthlyIfNoCache` (no cache, 5‑minute polling model — worst case)

### Web UI

- **Home** → **API discipline** card shows per-sport reference legs vs caps.
- **Desk** tab → **Elite Desk** shows economics + **Budget pulse** (monitor).

---

## 5. Synthetic placeholders (games)

When a game has **no priced player legs** yet:

- The **Games** tab can show **synthetic lean cards** (clearly labeled **Synth**).
- When **live legs** arrive from the API, synthetic rows disappear for that game.
- When a game is detected as **final / complete**, synthetic previews are **disabled** (no fake lines after the event).

Player-level **model projections** (when no API legs exist) are labeled **(model)** and are not stored as provider legs.

---

## 6. Elite Desk — unique leg panels

The **Desk** tab lists **one card per priced player leg** (unique join key: sport + date + matchup + label + market + side + line).

- **Post-game** legs are hidden by default (`deskLegFilter=active`).
- **Search** filters legs client-side (no extra API calls).
- **Pin** + **To Studio** integrate with Pick Studio.

---

## 7. Player headshots

- Firestore / API may store `headshot` URL — used first.
- Optional `espnAthleteId` (or `espnId`) enables ESPN CDN URLs:
  `https://a.espncdn.com/i/headshots/{league}/players/full/{id}.png`
- If missing or 404, UI falls back to **generated initials** avatar (SVG data URL) or legacy ui-avatars.

Populate `espnAthleteId` in `players` documents when you ingest roster data for best results.

---

## 8. Deploy checklist

1. Set secrets (`ODDS_API_KEY`, `RAPIDAPI_KEY`, hosts, bookmakers).
2. Deploy functions + hosting.
3. Run **Rapid Diagnostics (Lite)** from Account tab.
4. Full refresh; verify **Desk** shows legs and **Budget pulse** increments **monitor** counts.
5. When upgrading Odds API: set `ODDS_API_PLAN_MODE=paid` and optionally `ODDS_PROP_MARKET_TIER=standard` or `full`.

---

## 9. Support / tuning

- Tight on quota? → `ODDS_PROP_MARKET_TIER=core`, raise `PROPS_LIVE_CACHE_TTL_SECONDS`, keep `ENFORCE_BUDGET_GUARD=0` until stable.
- Need maximum rows? → paid plan + `paid` mode + `full` tier + higher soft limits.

---

## 10. Example: Firebase secrets (non-interactive pattern)

```bash
cd "/Users/brianbruce/Desktop/Hit-A-Lick"
firebase use hit-a-lick-database   # your project id

echo -n "YOUR_ODDS_KEY" | firebase functions:secrets:set ODDS_API_KEY
echo -n "YOUR_RAPID_KEY" | firebase functions:secrets:set RAPIDAPI_KEY
echo -n "odds.p.rapidapi.com" | firebase functions:secrets:set RAPIDAPI_ODDS_HOST
echo -n "fanduel,draftkings,betmgm,caesars,pointsbetus,espnbet" | firebase functions:secrets:set ODDS_API_BOOKMAKERS

firebase deploy --only functions
```

Bind secrets to the specific function(s) that need them in `functions/index.js` (already configured in your project pattern).

---

## 11. RapidAPI — which product?

Use **Live Sports Odds** (or your subscribed odds host) as **fallback** when direct Odds API is rate-limited or exhausted. Keep **one** primary Rapid host configured to avoid double-spend.

---

## 12. Troubleshooting

| Symptom | Likely cause | Action |
|--------|----------------|--------|
| 401 / quota on Odds API | Free key exhausted | Upgrade plan; set `ODDS_API_PLAN_MODE=paid` when key active |
| Empty player legs | Tier + market tier too shallow | `ODDS_PROP_MARKET_TIER=standard`, upgrade plan |
| Stale data | Cache TTL high | Lower TTL slightly; use `forceLive=1` for tests only |
| Synth cards won’t disappear | No player props in response | Confirm bookmakers list; check Rapid fallback |
| Desk shows 0 legs | Post-game filter on | Toggle “post-game archive”; widen sport scope |

---

## 13. Product philosophy

- **No fake provider legs** in Elite Desk grids — only priced legs from payloads.
- **Synth game cards** are UI-only scaffolding; they **must** disappear when priced legs attach.
- **Daily** history + pruning keeps Firestore lean (see `pruneHistoricalData`).

---

Last updated: auto-generated with Hit-A-Lick codebase.
