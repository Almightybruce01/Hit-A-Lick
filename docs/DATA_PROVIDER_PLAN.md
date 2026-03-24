# Data Provider Plan — Optimal Setup

**Last test run**: Odds API quota reached (401); RapidAPI fallback active. ESPN games + rosters OK.

---

## Test Results Summary

| Provider | Endpoint | Status | Notes |
|----------|----------|--------|-------|
| **The Odds API** | `/api/props` | 401 quota | Free tier exhausted → RapidAPI fallback |
| **RapidAPI (odds)** | `/api/props` | OK | Game lines returned; player props may vary by host |
| **ESPN** | Games, rosters, teams | OK | Scoreboard API + HTML scrape; no key required |
| **Firestore** | Players, teams | OK | Populated by ESPN scrapers (scheduled daily) |

---

## Recommended Plan

### Option A: Minimal change (keep ESPN for rosters) — **recommended**

Use **two APIs** and keep ESPN where it works best:

| Data | Source | Why |
|------|--------|-----|
| **Games (scoreboard, schedule)** | **ESPN** | Free, stable API (`site.api.espn.com`); no quota |
| **Teams** | **ESPN scrape** | Free; logos optional (add from ESPN CDN or keep null) |
| **Rosters (players)** | **ESPN scrape** | Free; headshots from ESPN CDN; scraper runs daily |
| **Odds + player props** | **The Odds API** (primary) + **RapidAPI** (fallback) | Odds API for paid plan; RapidAPI when quota/errors |

**Actions:**
1. Upgrade **The Odds API** to paid when you need reliable player props.
2. Keep RapidAPI configured as fallback (already works when Odds API 401s).
3. Keep ESPN scrapers (`scrapeTeams`, `scrapePlayers`, `cacheUpcomingGames`) and games API — no change.

---

### Option B: ESPN + Tank01 (two paid, one free)

If you want an API-backed roster instead of scraping:

| Data | Source | Why |
|------|--------|-----|
| **Games** | **ESPN API** | Free, stable |
| **Teams + rosters** | **RapidAPI Tank01** | `getNBATeams`, `getNBAPlayerList`, etc. — structured, no scrape |
| **Odds + props** | **The Odds API** + RapidAPI | Same as A |

**Actions:**
1. Add Tank01 ingestion: new jobs that call `getNBATeams` / `getNBAPlayerList` (and NFL/MLB/WNBA equivalents), write to Firestore `team` and `players`.
2. Deprecate ESPN `teamScraper` and `playerScraper` once Tank01 is reliable.
3. Keep ESPN for games (free) and schedule (or migrate schedule to Tank01 `getNBAGamesForDate`).

---

### Option C: Odds API + RapidAPI only (no ESPN)

| Data | Source | Why |
|------|--------|-----|
| **Games, teams, rosters** | **RapidAPI Tank01** | Single paid source for core data |
| **Odds + props** | **The Odds API** + RapidAPI odds | Same as A |

**Actions:**
1. Implement Tank01 for games, teams, players.
2. Remove ESPN scrapers and ESPN scoreboard from `games.js`.
3. Use The Odds API events as game list fallback if needed (lighter than Tank01).

---

## Clean Re-Routing (If Keeping ESPN)

Keep current structure; small tweaks for clarity:

1. **Games** (`games.js`): Keep ESPN scoreboard as primary. Cache in `_apiCache` (already done).
2. **Teams** (`teamScraper.js`): Keep. Add logo URL from ESPN CDN if desired (`a.espncdn.com/teamlogos`).
3. **Players** (`playerScraper.js`): Keep. Ensure `espnAthleteId` is set (numeric ID from href) so `PropHeadshotImage` can use ESPN CDN — scraper already saves `headshot` with CDN URL when using numeric `playerId`.
4. **Props** (`props.js`): Already has Odds API → RapidAPI fallback. Set `ODDS_API_PLAN_MODE=paid` when you have a paid Odds API plan.

---

## API Count Summary

| Plan | APIs | Cost |
|------|------|------|
| **A (recommended)** | ESPN (free) + Odds API (paid) + RapidAPI (fallback) | 1 paid (Odds API) |
| **B** | ESPN (free) + Odds API (paid) + RapidAPI (Tank01 + odds) | 2 paid (Odds API, RapidAPI) |
| **C** | Odds API (paid) + RapidAPI (Tank01 + odds) | 2 paid |

---

## Run Provider Test

```bash
bash scripts/provider-test.sh
```

Or with staging API:
```bash
HITALICK_API_BASE=https://your-staging.run.app bash scripts/provider-test.sh
```
