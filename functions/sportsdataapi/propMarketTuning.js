/**
 * The Odds API v4 — player prop market keys, tiered for request efficiency.
 *
 * Each distinct market may require additional GET batches (see ODDS_API_PLAYER_MARKET_BATCH_SIZE).
 * Tiers trade depth vs. quota:
 *   core     — highest-signal retail legs only (~4–8 markets / sport → ~1–2 batches)
 *   standard — balanced daily desk (default; matches previous Hit-A-Lick defaults)
 *   full     — maximum listed markets in the tables below (per sport)
 *   elite    — full + extra retail markets (MLB batters/pitcher alts, NFL combos/longest, WNBA mirrors NBA)
 *
 * Env: ODDS_PROP_MARKET_TIER = core | standard | full | elite
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
    "player_pass_longest_completion",
    "player_rush_attempts",
    "player_rush_yds",
    "player_rush_longest",
    "player_rush_tds",
    "player_receptions",
    "player_reception_yds",
    "player_reception_longest",
    "player_reception_tds",
    "player_pass_rush_yds",
    "player_pass_rush_reception_yds",
    "player_rush_reception_yds",
    "player_rush_reception_tds",
    "player_pass_rush_reception_tds",
    "player_kicking_points",
    "player_field_goals",
    "player_pats",
    "player_tackles_assists",
    "player_solo_tackles",
    "player_sacks",
  ],
  mlb: [
    "batter_hits",
    "batter_total_bases",
    "batter_rbis",
    "batter_runs_scored",
    "batter_home_runs",
    "batter_hits_runs_rbis",
    "batter_singles",
    "batter_doubles",
    "batter_triples",
    "batter_walks",
    "batter_strikeouts",
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
 * Elite — full slate + extra Odds API markets (more batches; for paid production).
 * WNBA mirrors NBA so hits / threes / blocks / alts are requested when books list them.
 */
export const PLAYER_PROP_MARKETS_ELITE = {
  nba: [
    ...PLAYER_PROP_MARKETS_FULL.nba,
    "player_field_goals",
    "player_frees_made",
    "player_frees_attempts",
    "player_blocks_steals",
  ],
  wnba: [...PLAYER_PROP_MARKETS_FULL.nba],
  nfl: [
    ...PLAYER_PROP_MARKETS_FULL.nfl,
    "player_pass_yds_q1",
    "player_tds_over",
    "player_pass_yds_alternate",
    "player_pass_tds_alternate",
    "player_rush_yds_alternate",
    "player_reception_yds_alternate",
    "player_receptions_alternate",
  ],
  mlb: [
    ...PLAYER_PROP_MARKETS_FULL.mlb,
    "batter_first_home_run",
    "batter_hits_alternate",
    "batter_rbis_alternate",
    "batter_home_runs_alternate",
    "batter_total_bases_alternate",
    "batter_walks_alternate",
    "batter_strikeouts_alternate",
    "batter_runs_scored_alternate",
    "batter_singles_alternate",
    "batter_doubles_alternate",
    "pitcher_strikeouts_alternate",
    "pitcher_hits_allowed_alternate",
    "pitcher_walks_alternate",
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
    "player_rush_longest",
    "player_reception_longest",
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
  elite: PLAYER_PROP_MARKETS_ELITE,
};

export function propMarketTierFromEnv() {
  const explicit = String(process.env.ODDS_PROP_MARKET_TIER || "").trim();
  const raw = explicit.toLowerCase();
  if (raw === "core" || raw === "minimal" || raw === "lite") return "core";
  if (raw === "elite" || raw === "maximum" || raw === "prod") return "elite";
  if (raw === "full" || raw === "max" || raw === "all") return "full";
  if (raw === "standard" || raw === "balanced") return "standard";
  const plan = String(process.env.ODDS_API_PLAN_MODE || "paid").toLowerCase();
  if (plan === "paid" || plan === "trial") return "elite";
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
  const desc =
    t === "core"
      ? "Lowest batch count: main scoring/usage markets only. Best for quota preservation."
      : t === "elite"
        ? "Widest configured retail + alt markets (NFL/MLB/WNBA depth); highest Odds API batch count."
        : t === "full"
          ? "Full base lists per sport (no extra alts beyond league table)."
          : "Balanced depth: strong retail coverage without every alternate/niche key.";
  const batches =
    t === "core" ? "1–2" : t === "standard" ? "2–4" : t === "full" ? "3–6" : "4–10";
  return {
    tier: t,
    description: desc,
    estimatedBatchesPerEvent: batches,
    envKey: "ODDS_PROP_MARKET_TIER",
  };
}
