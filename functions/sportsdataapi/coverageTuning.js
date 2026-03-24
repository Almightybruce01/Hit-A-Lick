/**
 * Coverage + quota tuning for The Odds API / multi-sport props.
 * Numbers are planning estimates (not guarantees) — adjust via env on deploy.
 *
 * ---------------------------------------------------------------------------
 * Research baseline (industry planning — NOT a guarantee from any provider):
 * - NBA regular season: books commonly list ~18–32 *distinct* player-prop markets
 *   per side on a busy TNT/ESPN night; priced legs (O/U + alt lines) can reach
 *   hundreds of rows per game when counting all books — we never pull “all rows”.
 * - NFL: TD + yardage + reception markets dominate; 22–36 market keys typical.
 * - MLB: batter Ks/H/RBI + pitcher Ks/ER/outs; fewer distinct markets but many alts.
 * - WNBA: structurally similar to NBA with smaller catalog depth.
 *
 * Odds API cost driver: (sports polled) × (events) × (market batches) × (books),
 * mitigated by PROPS_LIVE_CACHE_TTL_SECONDS (single-flight per sport per TTL).
 *
 * Target: stay **under** daily soft limits until you flip ODDS_API_PLAN_MODE=paid,
 * while still showing enough legs for EV scanning (tiered via ODDS_PROP_MARKET_TIER).
 * ---------------------------------------------------------------------------
 */

/** Typical priced player-prop legs per event at major US books (median slate — planning only). */
export const TYPICAL_PROP_LEGS_PER_EVENT = {
  nba: 22,
  wnba: 19,
  nfl: 28,
  mlb: 16,
};

/** Approximate distinct player-prop *market keys* offered on a median slate (not row count). */
export const TYPICAL_PLAYER_MARKET_KEYS_PER_EVENT = {
  nba: 26,
  wnba: 22,
  nfl: 30,
  mlb: 18,
};

/** Default live cache TTL (seconds) — align with PROPS_LIVE_CACHE_TTL_SECONDS */
export const DEFAULT_LIVE_CACHE_TTL = 55;

/**
 * Recommended max player-prop legs to pull per event from Odds API
 * (balances depth vs. request payload / quota).
 */
export function recommendedEventPropLimit(sport, planMode = "free") {
  const s = String(sport || "nba").toLowerCase();
  const base = TYPICAL_PROP_LEGS_PER_EVENT[s] ?? 20;
  const paid = String(planMode).toLowerCase() === "paid";
  if (!paid) {
    // Conservative: ~30–38% of typical leg depth — enough for desk work without
    // burning free-tier batches on every alt line. Raise via paid plan + tier env.
    return Math.min(7, Math.max(4, Math.round(base * 0.32)));
  }
  return Math.min(500, Math.max(14, Math.round(base * 1.1)));
}

/**
 * Rough monthly Odds API request ceiling if every sport is polled on an interval
 * with zero cache benefit (use for worst-case planning).
 */
export function estimateMonthlyOddsCallsWorstCase({
  sports = ["nba", "nfl", "mlb", "wnba"],
  pollIntervalMinutes = 5,
  activeHoursPerDay = 24,
} = {}) {
  const pollsPerDay = (activeHoursPerDay * 60) / Math.max(1, pollIntervalMinutes);
  const daily = pollsPerDay * sports.length;
  return {
    sports: sports.length,
    pollIntervalMinutes,
    activeHoursPerDay,
    dailyRequestsIfAlwaysCold: Math.round(daily),
    monthlyRequestsIfAlwaysCold: Math.round(daily * 30),
    note: "With PROPS_LIVE_CACHE_TTL_SECONDS≈55s, live pulls coalesce — real usage is far lower.",
  };
}

/**
 * Realistic daily pulls per sport assuming cache TTL hits (single-flight per sport per TTL window).
 */
export function estimateDailyCallsWithCache({
  sports = ["nba", "nfl", "mlb", "wnba"],
  cacheTtlSeconds = DEFAULT_LIVE_CACHE_TTL,
} = {}) {
  const windows = Math.ceil(86400 / Math.max(10, cacheTtlSeconds));
  return {
    cacheTtlSeconds,
    pullsPerSportPerDay: windows,
    totalPullsAllSports: windows * sports.length,
    monthlyEstimate: windows * sports.length * 30,
  };
}

export function coverageGuidancePayload(sport, planMode, eventPropLimit, windowDays, liveCacheTtlSec, source) {
  const tunedDefault = recommendedEventPropLimit(sport, planMode);
  const worst = estimateMonthlyOddsCallsWorstCase({ pollIntervalMinutes: 5 });
  const cached = estimateDailyCallsWithCache({ cacheTtlSeconds: liveCacheTtlSec });
  return {
    sport: String(sport || "").toLowerCase(),
    planMode: String(planMode || "free").toLowerCase(),
    tunedDefaultLimit: tunedDefault,
    activeLimit: eventPropLimit,
    windowDays,
    liveCacheTtlSeconds: liveCacheTtlSec,
    source: source || "unknown",
    typicalLegsReference: TYPICAL_PROP_LEGS_PER_EVENT[String(sport || "").toLowerCase()] ?? null,
    quotaHints: {
      worstCaseMonthlyOddsCalls: worst.monthlyRequestsIfAlwaysCold,
      realisticMonthlyWithLiveCache: cached.monthlyEstimate,
    },
  };
}

/** App default leagues (must match web + iOS sport filters). */
export const APP_SPORTS = ["nba", "nfl", "mlb", "wnba"];

/**
 * Rough typical *priced* events per heavy slate day (regular season — planning only).
 * Used to estimate how many player-leg rows you should expect vs API caps.
 */
export const TYPICAL_EVENTS_PER_ACTIVE_DAY = {
  nba: 8,
  wnba: 3,
  nfl: 10,
  mlb: 12,
};

/**
 * Full desk report: ties together cache TTL, per-sport leg expectations, and safe defaults.
 * Safe to attach to /props JSON — no extra provider calls.
 */
export function buildQuotaPlanningReport({
  sports = APP_SPORTS,
  planMode = "free",
  cacheTtlSeconds = DEFAULT_LIVE_CACHE_TTL,
  booksConfigured = 6,
} = {}) {
  const list = (Array.isArray(sports) ? sports : APP_SPORTS).map((sport) => {
    const s = String(sport || "nba").toLowerCase();
    const legs = TYPICAL_PROP_LEGS_PER_EVENT[s] ?? 20;
    const cap = recommendedEventPropLimit(s, planMode);
    const events = TYPICAL_EVENTS_PER_ACTIVE_DAY[s] ?? 6;
    const roughLegsDisplayed = Math.min(events * legs, Math.ceil(events * cap * 1.15));
    return {
      sport: s,
      typicalPricedLegsPerEvent: legs,
      apiLegCapPerEvent: cap,
      typicalEventsOnBusyDay: events,
      roughLegRowsOnBusyDay: Math.round(roughLegsDisplayed),
      note:
        planMode === "paid"
          ? "Paid mode: higher per-event cap; still bounded by Odds API market batches."
          : "Free/conservative mode: caps player-prop depth to protect quota until upgraded.",
    };
  });

  const cached = estimateDailyCallsWithCache({ sports: list.map((x) => x.sport), cacheTtlSeconds });
  const worst = estimateMonthlyOddsCallsWorstCase({
    sports: list.map((x) => x.sport),
    pollIntervalMinutes: 5,
  });

  return {
    generatedAt: new Date().toISOString(),
    planMode: String(planMode || "free").toLowerCase(),
    cacheTtlSeconds,
    booksConfigured,
    perSport: list,
    pullsPerSportPerDay: cached.pullsPerSportPerDay,
    totalPullsAllSportsPerDay: cached.totalPullsAllSports,
    realisticMonthlyWithLiveCache: cached.monthlyEstimate,
    worstCaseMonthlyIfNoCache: worst.monthlyRequestsIfAlwaysCold,
    playbook: [
      "Set PROPS_LIVE_CACHE_TTL_SECONDS to 45–90s so all users share one live pull per sport per TTL window.",
      "Use ODDS_PROP_MARKET_TIER=core for quota-tight periods; standard is the balanced default; full is for paid deep pulls.",
      "Historical dates read propHistory — no Odds API repeat spend once the day is warmed.",
      "ENFORCE_BUDGET_GUARD=0 (default) monitors usage without blocking; flip to 1 if you need hard caps.",
      "Free plan: recommendedEventPropLimit stays ~4–7 legs/event until ODDS_API_PLAN_MODE=paid.",
    ],
  };
}

/**
 * Single summary line for dashboards — how many “avg” priced legs your UI might
 * surface on a busy day given current caps (planning only).
 */
export function estimateBusyDayLegRowsForSport(sport, planMode = "free") {
  const s = String(sport || "nba").toLowerCase();
  const events = TYPICAL_EVENTS_PER_ACTIVE_DAY[s] ?? 6;
  const legs = TYPICAL_PROP_LEGS_PER_EVENT[s] ?? 20;
  const cap = recommendedEventPropLimit(s, planMode);
  const rough = Math.min(events * legs, Math.ceil(events * cap * 1.12));
  return {
    sport: s,
    typicalEventsOnBusyDay: events,
    typicalLegsPerEventReference: legs,
    apiLegCapPerEvent: cap,
    roughLegRowsOnBusyDay: Math.round(rough),
  };
}
