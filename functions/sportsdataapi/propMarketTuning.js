/**
 * The Odds API v4 — player prop market keys, tiered for request efficiency.
 *
 * Each distinct market may require additional GET batches (see ODDS_API_PLAYER_MARKET_BATCH_SIZE).
 * Tiers trade depth vs. quota:
 *   core     — highest-signal retail legs only (~4–8 markets / sport → ~1–2 batches)
 *   standard — balanced daily desk (default; matches previous Hit-A-Lick defaults)
 *   full     — maximum listed markets for paid-tier depth testing
 *
 * Env: ODDS_PROP_MARKET_TIER = core | standard | full   (default: standard)
 *
 * Reference (planning, not a guarantee): typical priced legs per slate
 *   NBA ~18–26  |  WNBA ~16–22  |  NFL ~22–34  |  MLB ~12–20
 */

export const PROP_MARKET_TIER_DEFAULT = "standard";

/** Full market lists — maximum depth (paid / analysis). */
export const PLAYER_PROP_MARKETS_FULL = {
  nba: [
    "player_points",
    "player_rebounds",
    "player_assists",
    "player_threes",
    "player_blocks",
    "player_steals",
    "player_turnovers",
    "player_points_rebounds_assists",
    "player_points_rebounds",
    "player_points_assists",
    "player_rebounds_assists",
    "player_double_double",
    "player_triple_double",
    "player_points_alternate",
    "player_rebounds_alternate",
    "player_assists_alternate",
    "player_threes_alternate",
  ],
  wnba: [
    "player_points",
    "player_rebounds",
    "player_assists",
    "player_turnovers",
    "player_points_rebounds_assists",
    "player_points_rebounds",
    "player_points_assists",
    "player_rebounds_assists",
    "player_double_double",
    "player_triple_double",
    "player_points_alternate",
    "player_rebounds_alternate",
    "player_assists_alternate",
  ],
  nfl: [
    "player_anytime_td",
    "player_1st_td",
    "player_last_td",
    "player_pass_tds",
    "player_pass_yds",
    "player_pass_attempts",
    "player_pass_completions",
    "player_pass_interceptions",
    "player_rush_attempts",
    "player_rush_yds",
    "player_longest_rush",
    "player_receptions",
    "player_reception_yds",
    "player_longest_reception",
    "player_kicking_points",
    "player_field_goals",
    "player_tackles_assists",
  ],
  mlb: [
    "batter_hits",
    "batter_total_bases",
    "batter_rbis",
    "batter_runs_scored",
    "batter_home_runs",
    "batter_hits_runs_rbis",
    "batter_stolen_bases",
    "pitcher_strikeouts",
    "pitcher_hits_allowed",
    "pitcher_walks",
    "pitcher_earned_runs",
    "pitcher_outs",
    "pitcher_record_a_win",
  ],
};

/**
 * Standard — same as legacy Hit-A-Lick behavior (good default when upgrading Odds API).
 * Drops only the most redundant alt/niche keys vs full for some sports.
 */
export const PLAYER_PROP_MARKETS_STANDARD = {
  nba: [
    "player_points",
    "player_rebounds",
    "player_assists",
    "player_threes",
    "player_blocks",
    "player_steals",
    "player_turnovers",
    "player_points_rebounds_assists",
    "player_points_rebounds",
    "player_points_assists",
    "player_rebounds_assists",
    "player_double_double",
    "player_triple_double",
    "player_points_alternate",
    "player_rebounds_alternate",
    "player_assists_alternate",
    "player_threes_alternate",
  ],
  wnba: [
    "player_points",
    "player_rebounds",
    "player_assists",
    "player_turnovers",
    "player_points_rebounds_assists",
    "player_points_rebounds",
    "player_points_assists",
    "player_rebounds_assists",
    "player_double_double",
    "player_triple_double",
    "player_points_alternate",
    "player_rebounds_alternate",
    "player_assists_alternate",
  ],
  nfl: [
    "player_anytime_td",
    "player_pass_tds",
    "player_pass_yds",
    "player_pass_completions",
    "player_rush_yds",
    "player_receptions",
    "player_reception_yds",
    "player_rush_attempts",
    "player_pass_interceptions",
    "player_kicking_points",
    ],
  mlb: [
    "batter_hits",
    "batter_total_bases",
    "batter_home_runs",
    "batter_runs_scored",
    "batter_rbis",
    "pitcher_strikeouts",
    "pitcher_hits_allowed",
    "pitcher_walks",
    "pitcher_earned_runs",
    "pitcher_outs",
  ],
};

/**
 * Core — minimum viable props for EV scanning (lowest batch count).
 * Focus: main scoring / usage markets with highest handle.
 */
export const PLAYER_PROP_MARKETS_CORE = {
  nba: [
    "player_points",
    "player_rebounds",
    "player_assists",
    "player_threes",
    "player_points_rebounds_assists",
    "player_points_rebounds",
  ],
  wnba: [
    "player_points",
    "player_rebounds",
    "player_assists",
    "player_points_rebounds_assists",
    "player_points_rebounds",
  ],
  nfl: [
    "player_pass_yds",
    "player_pass_tds",
    "player_rush_yds",
    "player_receptions",
    "player_reception_yds",
    "player_anytime_td",
  ],
  mlb: [
    "batter_hits",
    "batter_home_runs",
    "pitcher_strikeouts",
    "batter_total_bases",
    "pitcher_earned_runs",
  ],
};

const TIER_TABLE = {
  core: PLAYER_PROP_MARKETS_CORE,
  standard: PLAYER_PROP_MARKETS_STANDARD,
  full: PLAYER_PROP_MARKETS_FULL,
};

export function propMarketTierFromEnv() {
  const raw = String(process.env.ODDS_PROP_MARKET_TIER || PROP_MARKET_TIER_DEFAULT).toLowerCase();
  if (raw === "core" || raw === "minimal" || raw === "lite") return "core";
  if (raw === "full" || raw === "max" || raw === "all") return "full";
  return "standard";
}

export function resolvePlayerPropMarketsForSport(sport, tier = propMarketTierFromEnv()) {
  const s = String(sport || "").toLowerCase();
  const t = TIER_TABLE[tier] ? tier : "standard";
  const map = TIER_TABLE[t] || TIER_TABLE.standard;
  const list = map[s];
  return Array.isArray(list) ? [...list] : [];
}

/** Human-readable tuning notes for API responses + dashboards. */
export function propMarketTierMeta(tier = "standard") {
  const t = String(tier || "standard").toLowerCase();
  return {
    tier: t,
    description:
      t === "core"
        ? "Lowest batch count: main scoring/usage markets only. Best for quota preservation."
        : t === "full"
          ? "All configured markets; highest Odds API payload per event."
          : "Balanced depth (default): strong retail coverage without every alternate/niche key.",
    estimatedBatchesPerEvent: t === "core" ? "1–2" : t === "standard" ? "2–4" : "3–6",
    envKey: "ODDS_PROP_MARKET_TIER",
  };
}
