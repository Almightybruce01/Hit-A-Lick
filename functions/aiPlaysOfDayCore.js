/**
 * Shared logic for "AI plays of the day" (top live player-prop legs).
 * Kept in sync with site/app.html `computeAiPlaysOfTheDay`.
 */

export const AI_PLAYS_SPORTS = ["nba", "nfl", "mlb", "wnba"];

/** Matches `PREFERRED_BOOKMAKERS` in sportsdataapi/props.js (display sort only). */
const BOOK_QUOTE_ORDER = [
  "fanduel",
  "draftkings",
  "prizepicks",
  "underdog",
  "betmgm",
  "williamhill_us",
  "caesars",
  "pointsbetus",
  "espnbet",
  "pick6",
  "betr_us_dfs",
];

function bookQuoteSortRank(bookKey = "") {
  const k = String(bookKey || "").toLowerCase();
  const i = BOOK_QUOTE_ORDER.indexOf(k);
  return i === -1 ? 900 : i;
}

export function americanOddsMeetsMinPayout(american) {
  const o = Number(american);
  if (!Number.isFinite(o)) return false;
  if (o > 0) return true;
  return o >= -190;
}

export function normalizeToAmericanOdds(v) {
  if (v == null || v === "") return null;
  if (typeof v === "string") {
    const s = v.trim().replace(/−/g, "-").replace(/＋/g, "+");
    const m = s.match(/^([+-]?)(\d+(?:\.\d+)?)$/);
    if (m) {
      const sign = m[1];
      const num = Number(m[2]);
      if (!Number.isFinite(num)) return null;
      if (sign === "-") return -Math.round(Math.abs(num));
      if (sign === "+") return Math.round(num);
      if (num > 1 && num < 100 && String(m[2]).includes(".")) {
        if (num >= 2) return Math.round((num - 1) * 100);
        return Math.round(-100 / (num - 1));
      }
      return Math.round(num);
    }
    const n = Number(s);
    if (Number.isFinite(n)) return normalizeToAmericanOdds(n);
    return null;
  }
  const n = Number(v);
  if (!Number.isFinite(n) || n === 0) return null;
  if (n > 1 && n < 100 && Math.abs(n - Math.round(n)) > 1e-6) {
    if (n >= 2) return Math.round((n - 1) * 100);
    return Math.round(-100 / (n - 1));
  }
  return Math.round(n);
}

function americanOddsToImpliedDecimal(am) {
  const n = Number(am);
  if (!Number.isFinite(n) || n === 0) return null;
  if (n > 0) return 1 + n / 100;
  return 1 + 100 / Math.abs(n);
}

function propMarketAbbrev(key) {
  const k = String(key || "").toLowerCase();
  const map = {
    player_points: "PTS",
    player_rebounds: "REB",
    player_assists: "AST",
    player_threes: "3PM",
    player_blocks: "BLK",
    player_steals: "STL",
    player_turnovers: "TO",
    player_points_rebounds_assists: "PRA",
    player_points_rebounds: "P+R",
    player_points_assists: "P+A",
    player_rebounds_assists: "R+A",
    player_pass_yds: "PASS YDS",
    player_rush_yds: "RUSH",
    player_receptions: "REC",
  };
  if (map[k]) return map[k];
  return k.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()) || "PROP";
}

/** Full phrase for UI, e.g. "Points", "Rebounds". */
function propMarketDisplayTitle(key) {
  const k = String(key || "").toLowerCase();
  const map = {
    player_points: "Points",
    player_rebounds: "Rebounds",
    player_assists: "Assists",
    player_threes: "Three-pointers made",
    player_blocks: "Blocks",
    player_steals: "Steals",
    player_turnovers: "Turnovers",
    player_points_rebounds_assists: "Points + rebounds + assists",
    player_points_rebounds: "Points + rebounds",
    player_points_assists: "Points + assists",
    player_rebounds_assists: "Rebounds + assists",
    player_pass_yds: "Passing yards",
    player_rush_yds: "Rushing yards",
    player_receptions: "Receptions",
  };
  if (map[k]) return map[k];
  return propMarketAbbrev(key).replace(/\+/g, " + ");
}

function extractPlayerNameFromLegLabel(label) {
  const s = String(label || "").trim();
  if (!s) return "";
  const noOu = s.replace(/\s+(Over|Under)$/i, "").trim();
  const parts = noOu.split(/\s+/);
  const out = [];
  for (const p of parts) {
    if (/^\d/.test(p)) break;
    if (/^o\/u$/i.test(p)) break;
    out.push(p);
  }
  return out.length ? out.join(" ") : noOu;
}

function legOuSideLabel(leg) {
  const s = String(leg?.side || "").toLowerCase().trim();
  if (!s) return "";
  if (s === "over" || s === "o") return "Over";
  if (s === "under" || s === "u") return "Under";
  if (s === "yes" || s === "y") return "Yes";
  if (s === "no" || s === "n") return "No";
  if (s.includes("over")) return "Over";
  if (s.includes("under")) return "Under";
  return s.replace(/\b\w/g, (c) => c.toUpperCase());
}

function buildLegReadableLine(leg) {
  const mk = propMarketAbbrev(leg.market);
  const ou = legOuSideLabel(leg);
  const line = leg.line != null && leg.line !== "" ? String(leg.line) : "";
  const parts = [];
  if (ou) parts.push(ou);
  if (line) parts.push(line);
  parts.push(mk);
  return parts.filter(Boolean).join(" ");
}

/** e.g. "LaMelo Ball Over 5.5 Rebounds" */
function buildLegPropSentence(leg) {
  const rawPlayer = String(leg.playerName || "").trim();
  const fromLabel = extractPlayerNameFromLegLabel(leg.label);
  const player = (rawPlayer || fromLabel || "Player").trim();
  const ou = legOuSideLabel(leg);
  const line = leg.line != null && leg.line !== "" ? String(leg.line) : "";
  const marketTitle = propMarketDisplayTitle(leg.market);
  const bits = [player];
  if (ou) bits.push(ou);
  if (line) bits.push(line);
  bits.push(marketTitle);
  return bits.filter(Boolean).join(" ");
}

function isAltPlayerMarket(market) {
  const k = String(market || "").toLowerCase();
  return k.includes("alternate") || k.includes("_alt") || k.endsWith("alt");
}

function hoursUntilCommenceProp(prop) {
  const iso = prop?.commenceTime || prop?.date;
  if (!iso) return null;
  const raw = String(iso);
  const t = Date.parse(raw.length <= 10 ? `${raw.slice(0, 10)}T20:00:00.000Z` : raw);
  if (!Number.isFinite(t)) return null;
  return (t - Date.now()) / 3600000;
}

/** Mirrors site `computeLegConfidenceForDisplay` for scheduled snapshots. */
function computeLegConfidenceForSnapshot(leg, prop) {
  const base = Number(prop?.confidence || 0);
  const rel = Number(prop?.analytics?.reliabilityScore || 0) / 100;
  const edgeN = Number(prop?.analytics?.edgeCount || 0);
  const am = normalizeToAmericanOdds(leg.odds) ?? -110;
  const dec = americanOddsToImpliedDecimal(am);
  const ip = dec ? 1 / dec : 0.52;

  let score = base * (0.5 + 0.4 * rel) + Math.min(8, edgeN * 1.05);

  if (am < -350) score -= 12;
  else if (am < -280) score -= 9;
  else if (am < -220) score -= 6;
  else if (am > 0) score += Math.min(9, am / 32);

  if (ip > 0.62 && am < 0) score -= Math.min(9, (ip - 0.55) * 95);
  if (ip < 0.42 && am > 0) score += Math.min(6, (0.48 - ip) * 70);

  if (isAltPlayerMarket(leg.market)) score -= 6;

  const completeness = [leg.bookKey, leg.market, leg.label].filter((x) => String(x || "").trim()).length;
  if (completeness < 3) score -= 5;

  if (prop?.analytics?.steamFlag) score -= 4;

  const hu = hoursUntilCommenceProp(prop);
  if (hu != null) {
    if (hu < -0.25) score -= 5;
    else if (hu < 1.5) score += 2;
    else if (hu > 168) score -= 3;
  }

  return Math.max(33, Math.min(96, Math.round(score)));
}

function legValueRatio(leg, prop, legConf) {
  const am = normalizeToAmericanOdds(leg.odds);
  const dec = am != null ? americanOddsToImpliedDecimal(am) : null;
  const ip = dec ? 1 / dec : null;
  if (!ip || ip <= 0) return 0;
  return (legConf / 100) / Math.max(0.065, ip);
}

/**
 * @param {any[]} props - Firestore/API prop rows with playerProps[]
 * @param {number} max
 * @returns {object[]} plain pick rows (no _score)
 */
export function computeAiPlaysOfTheDayFromProps(props, max = 3) {
  const minConf = 60;
  const rows = [];
  for (const p of props || []) {
    const gConf = Number(p.confidence || 0);
    if (gConf < minConf - 5) continue;
    for (const leg of p.playerProps || []) {
      if (!leg || leg.synthetic || leg.projected) continue;
      const lbl = String(leg.label || "").toLowerCase();
      if (lbl.includes("synthetic") || lbl.includes("placeholder")) continue;

      const rawQuotes =
        Array.isArray(leg.bookQuotes) && leg.bookQuotes.length
          ? leg.bookQuotes
          : [{ bookKey: leg.bookKey, odds: leg.odds, bookName: leg.bookName }];

      const normalized = [];
      for (const q of rawQuotes) {
        const bk = String(q.bookKey || "").trim();
        if (!bk) continue;
        const am = normalizeToAmericanOdds(q.odds);
        if (am == null) continue;
        normalized.push({ bookKey: bk, bookName: q.bookName || null, odds: am });
      }
      if (!normalized.length) continue;

      const qualifying = normalized.filter((q) => americanOddsMeetsMinPayout(q.odds));
      if (!qualifying.length) continue;

      qualifying.sort((a, b) => {
        const ar = bookQuoteSortRank(a.bookKey);
        const br = bookQuoteSortRank(b.bookKey);
        if (ar !== br) return ar - br;
        return (b.odds || 0) - (a.odds || 0);
      });
      const primary = qualifying[0];
      const legForScore = { ...leg, bookKey: primary.bookKey, odds: primary.odds };
      const legConf = computeLegConfidenceForSnapshot(legForScore, p);
      if (legConf < minConf) continue;
      const am = primary.odds;
      const plusBump = am > 0 ? Math.min(12, am / 20) : 0;
      const rel = Number(p?.analytics?.reliabilityScore || 0);
      const vr = legValueRatio(legForScore, p, legConf);
      const valueBump = vr >= 1.12 ? 4 : 0;
      const score = legConf + plusBump + gConf * 0.03 + rel * 0.02 + valueBump;

      const displayName = String(leg.label || "Player").trim();
      const propText = buildLegReadableLine(leg);
      const propSentence = buildLegPropSentence(leg);

      normalized.sort((a, b) => {
        const ar = bookQuoteSortRank(a.bookKey);
        const br = bookQuoteSortRank(b.bookKey);
        if (ar !== br) return ar - br;
        return (b.odds || 0) - (a.odds || 0);
      });
      const quotesOut = normalized.slice(0, 12).map((q) => ({
        bookKey: q.bookKey,
        odds: q.odds,
        okPrice: americanOddsMeetsMinPayout(q.odds),
      }));

      rows.push({
        _score: score,
        matchup: p.matchup || "",
        sport: String(p.sport || "").toUpperCase(),
        label: displayName,
        propText,
        propSentence,
        line: leg.line,
        side: leg.side ?? null,
        odds: am,
        bookKey: primary.bookKey || "",
        quotes: quotesOut,
        confidence: Math.round(legConf),
      });
    }
  }
  rows.sort((a, b) => b._score - a._score);
  return rows.slice(0, max).map(({ _score, ...rest }) => rest);
}
