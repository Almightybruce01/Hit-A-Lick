import axios from "axios";
import cheerio from "cheerio";
import { db, admin } from "./firebaseConfig.js";
import { asNumber } from "./analytics.js";
import { seasonKeyForSport, isHistoricalDate, ymd } from "./season.js";
import { allowLiveCall } from "./requestBudget.js";
import {
  recommendedEventPropLimit,
  coverageGuidancePayload,
  buildQuotaPlanningReport,
} from "./coverageTuning.js";
import {
  resolvePlayerPropMarketsForSport,
  propMarketTierFromEnv,
  propMarketTierMeta,
} from "./propMarketTuning.js";
import { enrichPropsWithEntityResolution, parseMatchupTeams } from "./entityResolve.js";

/** Display / merge priority — retail books first, then DFS (Odds API `us_dfs` region). */
const PREFERRED_BOOKMAKERS = [
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

const CORE_MARKETS = ["h2h", "spreads", "totals"];

const SPORT_ODDS_KEYS = {
  nba: "basketball_nba",
  mlb: "baseball_mlb",
  nfl: "americanfootball_nfl",
  wnba: "basketball_wnba",
};

const SCOREBOARD_ENDPOINTS = {
  nba: "https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard",
  nfl: "https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard",
  mlb: "https://site.api.espn.com/apis/site/v2/sports/baseball/mlb/scoreboard",
  wnba: "https://site.api.espn.com/apis/site/v2/sports/basketball/wnba/scoreboard",
};
const SPORT_LIST = ["nba", "nfl", "mlb", "wnba"];

function envPositiveInt(name, fallback, max = 10000) {
  const raw = Number(process.env[name]);
  if (!Number.isFinite(raw) || raw <= 0) return fallback;
  return Math.min(Math.trunc(raw), max);
}

function chunkArray(items, chunkSize) {
  const out = [];
  if (!Array.isArray(items) || !items.length) return out;
  const size = Math.max(1, Number(chunkSize) || 1);
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

async function requestWithRetry(config, attempts = 2) {
  let lastErr;
  for (let i = 0; i < attempts; i += 1) {
    try {
      return await axios.request(config);
    } catch (err) {
      lastErr = err;
      const status = err?.response?.status;
      // Retry only transient failures.
      if (status && status < 500 && status !== 429) break;
      if (i < attempts - 1) {
        await new Promise((r) => setTimeout(r, 250 * (i + 1)));
      }
    }
  }
  throw lastErr;
}

function configuredBookmakers() {
  const raw = String(process.env.ODDS_API_BOOKMAKERS || "").trim();
  if (!raw) return [];
  return raw.split(",").map((b) => b.trim().toLowerCase()).filter(Boolean);
}

/** DFS book keys require The Odds API region `us_dfs` (can combine with `us`). */
const DFS_BOOKMAKER_KEYS = new Set([
  "prizepicks",
  "underdog",
  "pick6",
  "betr_us_dfs",
]);

/**
 * Regions for Odds API v4. Override with ODDS_API_REGIONS (e.g. `us` or `us,us_dfs`).
 * When any configured bookmaker is DFS, default includes both US retail and US DFS.
 */
function oddsApiRegionsParam() {
  const explicit = String(process.env.ODDS_API_REGIONS || "").trim();
  if (explicit) return explicit;
  const books = configuredBookmakers();
  const needsDfs = books.some((b) => DFS_BOOKMAKER_KEYS.has(b));
  return needsDfs ? "us,us_dfs" : "us";
}

function rapidApiConfig() {
  const key = String(process.env.RAPIDAPI_KEY || "").trim();
  const host =
    String(process.env.RAPIDAPI_ODDS_HOST || "").trim() ||
    String(process.env.RAPIDAPI_HOST || "").trim();
  const baseUrl =
    String(process.env.RAPIDAPI_ODDS_BASE_URL || "").trim() ||
    (host ? `https://${host}` : "");
  return {
    key,
    host,
    baseUrl,
    enabled: Boolean(key && host),
  };
}

function propsCacheDoc(sport) {
  return db.collection("_apiCache").doc(`props_${sport}`);
}

function propHistoryCollection() {
  return db.collection("propHistory");
}

async function readPropsCache(sport) {
  const snap = await propsCacheDoc(sport).get();
  if (!snap.exists) return null;
  const data = snap.data() || {};
  return {
    props: Array.isArray(data.props) ? data.props : [],
    source: data.source || "cache",
    cachedAt: data.cachedAt || null,
    cachedAtIso: data.cachedAtIso || null,
  };
}

function espnHeadshotUrlForCache(sport, espnAthleteId) {
  const id = String(espnAthleteId || "").trim();
  if (!/^\d+$/.test(id)) return null;
  const league = espnLeagueFolderFromSport(sport);
  return `https://a.espncdn.com/i/headshots/${league}/players/full/${id}.png`;
}

function slimLegForPropsCache(leg, sport) {
  if (!leg || typeof leg !== "object") return {};
  const out = {};
  for (const k of ["market", "label", "side", "line", "odds", "bookKey", "bookName", "playerName", "espnAthleteId", "synthetic"]) {
    if (leg[k] !== undefined) out[k] = leg[k];
  }
  const h = String(leg.headshot || "").trim();
  if (/^https?:\/\//i.test(h)) out.headshot = h;
  else {
    const built = espnHeadshotUrlForCache(sport, leg.espnAthleteId);
    if (built) out.headshot = built;
  }
  return out;
}

/** Firestore doc limit 1MB — never spread full `enriched` rows into cache (elite tiers are huge). */
function slimPropRowForPropsCache(p, maxLegsPerEvent) {
  const cap = Math.max(4, Number(maxLegsPerEvent) || 200);
  const legs = Array.isArray(p?.playerProps)
    ? p.playerProps.slice(0, cap).map((leg) => slimLegForPropsCache(leg, p.sport))
    : [];
  const a = p.analytics && typeof p.analytics === "object" ? p.analytics : null;
  const row = {
    sport: p.sport,
    matchup: p.matchup,
    spread: p.spread,
    moneyline: p.moneyline,
    total: p.total,
    date: p.date,
    commenceTime: p.commenceTime,
    source: p.source,
    availableBooks: Array.isArray(p.availableBooks) ? p.availableBooks : [],
    preferredBook: p.preferredBook ?? null,
    tags: Array.isArray(p.tags) ? p.tags.slice(0, 16) : [],
    books: [],
    playerProps: legs,
  };
  if (p.confidence !== undefined) row.confidence = p.confidence;
  if (p.confidenceBand !== undefined) row.confidenceBand = p.confidenceBand;
  if (a) {
    const ax = {};
    if (a.hasPlayerProps !== undefined) ax.hasPlayerProps = a.hasPlayerProps;
    if (a.playerPropsCount !== undefined) ax.playerPropsCount = a.playerPropsCount;
    if (a.reliabilityScore !== undefined) ax.reliabilityScore = a.reliabilityScore;
    if (a.steamFlag !== undefined) ax.steamFlag = a.steamFlag;
    ax.playerPropsCount = Math.max(legs.length, Number(ax.playerPropsCount || 0));
    if (Object.keys(ax).length) {
      const aClean = {};
      for (const [ak, av] of Object.entries(ax)) {
        if (av !== undefined) aClean[ak] = av;
      }
      if (Object.keys(aClean).length) row.analytics = aClean;
    }
  }
  const cleaned = {};
  for (const [k, v] of Object.entries(row)) {
    if (v !== undefined) cleaned[k] = v;
  }
  return cleaned;
}

async function writePropsCache(sport, payload) {
  const maxEvents = envPositiveInt("PROPS_CACHE_MAX_EVENTS", 72, 140);
  const maxLegsPerEvent = envPositiveInt("PROPS_CACHE_MAX_PLAYER_PROPS_PER_EVENT", 240, 420);
  const slimProps = (Array.isArray(payload?.props) ? payload.props : [])
    .slice(0, maxEvents)
    .map((p) => slimPropRowForPropsCache(p, maxLegsPerEvent));
  await propsCacheDoc(sport).set(
    {
      sport,
      ...payload,
      props: slimProps,
      cachedAt: admin.firestore.FieldValue.serverTimestamp(),
      cachedAtIso: new Date().toISOString(),
    },
    { merge: true }
  );
}

function cacheIsFresh(isoLike, ttlSeconds = 55) {
  const ttl = Math.max(10, Number(ttlSeconds) || 55);
  const ts = Date.parse(String(isoLike || ""));
  if (!Number.isFinite(ts)) return false;
  return Date.now() - ts <= ttl * 1000;
}

async function readPropHistoryByDay(sport, dayKey, includeBooks = false, limit = 900) {
  const snap = await propHistoryCollection()
    .where("sport", "==", sport)
    .where("dayKey", "==", dayKey)
    .limit(limit)
    .get();
  const rows = snap.docs.map((doc) => doc.data() || {});
  return rows.map((p) => ({
    ...p,
    books: includeBooks ? (Array.isArray(p.books) ? p.books : []) : [],
  }));
}

async function writePropHistorySnapshots(sport, props = []) {
  if (!Array.isArray(props) || !props.length) return 0;
  const batchSize = 300;
  let writes = 0;
  for (let i = 0; i < props.length; i += batchSize) {
    const batch = db.batch();
    for (const prop of props.slice(i, i + batchSize)) {
      const dayKey = String(prop?.date || ymd(new Date()));
      const seasonKey = seasonKeyForSport(dayKey, sport);
      const safeMatchup = String(prop.matchup || "unknown")
        .replace(/[^a-zA-Z0-9_-]+/g, "_")
        .slice(0, 140);
      const docId = `${sport}_${dayKey}_${safeMatchup}`;
      batch.set(
        propHistoryCollection().doc(docId),
        {
          ...prop,
          sport,
          dayKey,
          seasonKey,
          books: slimBooksForStorage(Array.isArray(prop.books) ? prop.books : []),
          archivedAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
      writes += 1;
    }
    await batch.commit();
  }
  return writes;
}

async function writeClvTimelineSamples(sport, props = []) {
  if (!Array.isArray(props) || !props.length) return 0;
  const nowIso = new Date().toISOString();
  let writes = 0;
  const batch = db.batch();
  for (const prop of props.slice(0, 450)) {
    const matchup = String(prop?.matchup || "unknown").slice(0, 120);
    const topEdges = Array.isArray(prop?.analytics?.topEdges) ? prop.analytics.topEdges.slice(0, 3) : [];
    const clv = prop?.analytics?.clvReady || {};
    for (const edge of topEdges) {
      const market = String(edge?.market || "market").slice(0, 60);
      const side = String(edge?.side || "side").slice(0, 30);
      const line = edge?.line ?? "na";
      const key = `${sport}_${matchup}_${market}_${side}_${line}`.replace(/[^a-zA-Z0-9_.-]+/g, "_").slice(0, 220);
      const docRef = db.collection("propClvTimeline").doc(key).collection("points").doc();
      batch.set(docRef, {
        sport,
        matchup,
        market,
        side,
        line,
        bestBook: edge?.bestBook || null,
        bestOdds: edge?.bestOdds ?? null,
        fairOdds: edge?.fairOdds ?? null,
        edgePct: edge?.edgePct ?? null,
        confidence: prop?.confidence ?? null,
        confidenceBand: prop?.confidenceBand || null,
        source: prop?.source || null,
        baselineCapturedAt: clv?.baselineCapturedAt || nowIso,
        openOddsSnapshot: clv?.openOddsSnapshot || null,
        lastOddsSnapshot: clv?.lastOddsSnapshot || null,
        sampledAt: admin.firestore.FieldValue.serverTimestamp(),
        sampledAtIso: nowIso,
      });
      writes += 1;
    }
  }
  if (writes > 0) await batch.commit();
  return writes;
}

async function readRichPropsFromFirestore(sport, maxDocs = 500) {
  const snap = await db.collection("props").where("sport", "==", sport).limit(maxDocs).get();
  const rows = snap.docs.map((doc) => doc.data() || {});
  const rich = rows.filter((item) => Array.isArray(item.playerProps) && item.playerProps.length > 0);
  if (!rich.length) return [];
  return rich.map((item) => ({
    sport,
    matchup: item.matchup || "",
    spread: sanitizeMarketText(item.spread || "N/A"),
    moneyline: item.moneyline || "N/A",
    total: sanitizeMarketText(item.total || "N/A"),
    date: item.date || new Date().toISOString().slice(0, 10),
    source: item.source || "firestore_cache",
    commenceTime: item.commenceTime || null,
    availableBooks: Array.isArray(item.availableBooks) ? item.availableBooks : [],
    books: Array.isArray(item.books) ? item.books : [],
    preferredBook: item.preferredBook || null,
    analytics: item.analytics || null,
    playerProps: Array.isArray(item.playerProps) ? item.playerProps : [],
  }));
}

function normalizeHalfStep(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return null;
  return (Math.round(num * 2) / 2).toFixed(1);
}

function sanitizeMarketText(text = "") {
  return String(text).replace(/-?\d+(\.\d+)?/g, (match) => {
    const normalized = normalizeHalfStep(match);
    return normalized ?? match;
  });
}

function parseEventDate(value) {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function propScheduledDate(prop) {
  if (prop?.commenceTime) return parseEventDate(prop.commenceTime);
  if (prop?.date) return parseEventDate(`${prop.date}T12:00:00Z`);
  return null;
}

function filterPropsToWindow(props = [], windowDays = 3) {
  const now = new Date();
  const cutoffPast = new Date(now.getTime() - 2 * 60 * 60 * 1000);
  const end = new Date(now.getTime() + Math.max(1, Number(windowDays) || 3) * 24 * 60 * 60 * 1000);
  return props.filter((prop) => {
    const when = propScheduledDate(prop);
    if (!when) return true;
    return when >= cutoffPast && when <= end;
  });
}

function confidenceBand(score) {
  if (score >= 72) return "green";
  if (score >= 55) return "yellow";
  return "red";
}

function computePropConfidence(prop, source) {
  const booksCount = Array.isArray(prop?.availableBooks) ? prop.availableBooks.length : 0;
  const playerPropCount = Array.isArray(prop?.playerProps) ? prop.playerProps.length : 0;
  const lineFields = [prop?.spread, prop?.total, prop?.moneyline];
  const lineCompleteness = lineFields.filter((x) => String(x || "").toUpperCase() !== "N/A").length / 3;

  const sourceBase = {
    odds_api: 76,
    rapidapi_odds: 73,
    firestore_cache: 67,
    stale_cache: 64,
    espn_fallback: 52,
    scoreboard_fallback: 48,
    degraded_empty: 40,
  }[source] ?? 58;

  const booksBoost = Math.min(16, booksCount * 2.2);
  const propDepthBoost = Math.min(12, Math.log10(1 + playerPropCount) * 8.5);
  const lineBoost = lineCompleteness * 7;
  const rangePenalty =
    Number(prop?.analytics?.moneylineRange?.delta || 0) > 500 ? 4 : 0;
  const spreadDelta = Number(prop?.analytics?.spreadRange?.delta || 0);
  const mlDelta = Number(prop?.analytics?.moneylineRange?.delta || 0);
  /** Wider book disagreement → less “sure” confidence (proxy until defense/position ranks are wired in). */
  const disagreementPenalty =
    (spreadDelta > 2.5 ? 3 : 0) + (mlDelta > 120 ? 3 : mlDelta > 80 ? 2 : 0);
  const depthCeiling =
    booksCount >= 4 && playerPropCount >= 14 ? 94 : booksCount >= 3 && playerPropCount >= 8 ? 91 : 88;

  const micro = microstructureSignals(prop);
  const steamPenalty = micro.steamFlag ? 4 : 0;
  const edgeList = deriveTopPropEdges(prop.playerProps || [], 24);
  const edgeBoost = Math.min(6, edgeList.length * 0.9);

  const when = propScheduledDate(prop);
  let tipAdj = 0;
  if (when) {
    const hours = (when.getTime() - Date.now()) / 3600000;
    if (hours < -0.5) tipAdj = -5;
    else if (hours < 2) tipAdj = 2;
    else if (hours > 120) tipAdj = -3;
  }

  const raw =
    sourceBase +
    booksBoost +
    propDepthBoost +
    lineBoost -
    rangePenalty -
    disagreementPenalty -
    steamPenalty +
    edgeBoost +
    tipAdj;
  return Math.max(35, Math.min(depthCeiling, Math.round(raw)));
}

function americanFromProbability(prob) {
  if (!Number.isFinite(prob) || prob <= 0 || prob >= 1) return null;
  if (prob >= 0.5) return -Math.round((prob / (1 - prob)) * 100);
  return Math.round(((1 - prob) / prob) * 100);
}

function reliabilityScore(prop, source) {
  const books = Array.isArray(prop?.availableBooks) ? prop.availableBooks.length : 0;
  const propDepth = Array.isArray(prop?.playerProps) ? prop.playerProps.length : 0;
  const sourceBase = {
    odds_api: 88,
    rapidapi_odds: 84,
    stale_cache: 72,
    firestore_cache: 69,
    espn_fallback: 58,
    scoreboard_fallback: 52,
    degraded_empty: 42,
  }[source] ?? 60;
  const score = sourceBase + Math.min(8, books * 1.2) + Math.min(6, Math.log10(1 + propDepth) * 4.8);
  return Math.max(35, Math.min(99, Math.round(score)));
}

function microstructureSignals(prop = {}) {
  const mlDelta = Number(prop?.analytics?.moneylineRange?.delta || 0);
  const spreadDelta = Number(prop?.analytics?.spreadRange?.delta || 0);
  const steamFlag = mlDelta >= 35 || spreadDelta >= 1.5;
  const spoofRisk = mlDelta >= 90 ? "high" : mlDelta >= 45 ? "medium" : "low";
  const velocity = Math.round((mlDelta * 0.6) + (spreadDelta * 12));
  return { steamFlag, spoofRisk, velocity };
}

function deriveTopPropEdges(playerProps = [], limit = 8) {
  const groups = new Map();
  for (const item of playerProps || []) {
    const odds = asNumber(item.odds);
    if (odds == null || odds === 0) continue;
    const key = [
      String(item.market || "").toLowerCase(),
      String(item.label || "").toLowerCase(),
      String(item.side || "").toLowerCase(),
      item.line ?? "",
    ].join("|");
    const list = groups.get(key) || [];
    list.push(item);
    groups.set(key, list);
  }

  const edges = [];
  for (const [key, list] of groups.entries()) {
    if (list.length < 2) continue;
    const implied = list
      .map((x) => impliedProbability(x.odds))
      .filter((v) => Number.isFinite(v));
    if (!implied.length) continue;
    const best = Math.min(...implied);
    const consensus = implied.reduce((a, b) => a + b, 0) / implied.length;
    const edgePct = Number(((consensus - best) * 100).toFixed(2));
    if (edgePct <= 0) continue;

    const bestLeg = list
      .slice()
      .sort((a, b) => (impliedProbability(a.odds) || 1) - (impliedProbability(b.odds) || 1))[0];
    edges.push({
      key,
      market: bestLeg.market || null,
      label: bestLeg.label || null,
      side: bestLeg.side || null,
      line: bestLeg.line ?? null,
      bestBook: bestLeg.bookName || bestLeg.bookKey || null,
      bestOdds: bestLeg.odds ?? null,
      bestImplied: Number(best.toFixed(4)),
      consensusImplied: Number(consensus.toFixed(4)),
      edgePct,
      fairOdds: americanFromProbability(consensus),
    });
  }

  return edges.sort((a, b) => b.edgePct - a.edgePct).slice(0, limit);
}

function enrichDerivedAnalytics(prop, source) {
  const topEdges = deriveTopPropEdges(prop.playerProps || []);
  const micro = microstructureSignals(prop);
  const booksCount = Array.isArray(prop.availableBooks) ? prop.availableBooks.length : 0;
  const ts = new Date().toISOString();
  const baselineSnapshot = topEdges.map((e) => ({
    market: e.market,
    label: e.label,
    side: e.side,
    line: e.line,
    book: e.bestBook,
    odds: e.bestOdds,
  }));
  const sourceConfidenceDecay = source === "odds_api" || source === "rapidapi_odds"
    ? 0
    : source === "stale_cache" || source === "firestore_cache"
      ? 10
      : 18;
  return {
    ...(prop.analytics || {}),
    booksCount,
    topEdges,
    edgeCount: topEdges.length,
    reliabilityScore: reliabilityScore(prop, source),
    sourceConfidenceDecay,
    microstructure: micro,
    steamFlag: micro.steamFlag,
    clvReady: {
      baselineCapturedAt: ts,
      openOddsSnapshot: baselineSnapshot,
      lastOddsSnapshot: baselineSnapshot,
    },
  };
}

/** Delete stored prop docs after event window (post-game + slack). */
const POST_GAME_SLACK_MS = 5 * 60 * 60 * 1000;

function shouldDeleteStoredProp(data, now = new Date()) {
  const when = propScheduledDate(data);
  if (!when) {
    const dk = String(data.date || "").slice(0, 10);
    if (!dk) return false;
    const endOfDay = Date.parse(`${dk}T23:59:59.999Z`);
    return Number.isFinite(endOfDay) && now.getTime() > endOfDay + 3600000;
  }
  return now.getTime() > when.getTime() + POST_GAME_SLACK_MS;
}

function stripSyntheticPlayerLegs(prop) {
  const legs = Array.isArray(prop.playerProps) ? prop.playerProps : [];
  if (!legs.some((l) => l && l.synthetic)) return prop;
  return {
    ...prop,
    playerProps: legs.filter((l) => !l.synthetic),
  };
}

/** ESPN CDN folder segment for headshots (matches web client). */
function espnLeagueFolderFromSport(sport) {
  const s = String(sport || "").toLowerCase();
  if (s === "nba") return "nba";
  if (s === "wnba") return "wnba";
  if (s === "nfl") return "nfl";
  if (s === "mlb") return "mlb";
  return "nba";
}

/**
 * Best-effort player name from Odds API outcome label (e.g. "LeBron James 25.5", "Over").
 */
function extractPlayerNameFromLabel(label) {
  const s = String(label || "").trim();
  if (!s) return null;
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

function headshotUrlForLeg({ sport, espnAthleteId }) {
  const league = espnLeagueFolderFromSport(sport);
  const id = String(espnAthleteId || "").trim();
  if (/^\d+$/.test(id)) {
    return `https://a.espncdn.com/i/headshots/${league}/players/full/${id}.png`;
  }
  return null;
}

/** Normalize player name for roster matching (lowercase, no suffixes, collapse spaces). */
function normalizePlayerNameForMatch(name) {
  if (!name || typeof name !== "string") return "";
  return name
    .toLowerCase()
    .replace(/-/g, " ")
    .replace(/\./g, " ")
    .replace(/['`]/g, "")
    .replace(/\b(jr\.?|sr\.?|iii|ii|iv)\b/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenOverlapScore(rawName, rosterDisplayName) {
  const A = new Set(normalizePlayerNameForMatch(rawName).split(/\s+/).filter((t) => t.length > 0));
  const B = new Set(normalizePlayerNameForMatch(rosterDisplayName).split(/\s+/).filter((t) => t.length > 0));
  let n = 0;
  for (const t of A) if (B.has(t)) n += 1;
  return n;
}

/** Extra keys beyond full normalized name (Odds labels vs roster spellings). */
function expandPlayerNameMatchKeys(playerName) {
  const nk = normalizePlayerNameForMatch(playerName);
  if (!nk) return [];
  const keys = new Set([nk]);
  const parts = nk.split(/\s+/).filter((t) => t.length > 0);
  if (parts.length >= 2) {
    const first = parts[0];
    const last = parts[parts.length - 1];
    if (first.length && last.length >= 2) {
      keys.add(`${first[0]} ${last}`);
      keys.add(`${first[0]}${last}`);
    }
    if (parts.length >= 3) {
      keys.add(`${parts[0]} ${last}`);
    }
  }
  return [...keys];
}

function normalizeTeamTokenForMatch(raw) {
  return String(raw || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

/** Roster rows for cross-provider matching: name keys, team text, ESPN id. */
async function buildPlayerRosterMatchContext(sport) {
  const byNormName = new Map();
  const flat = [];
  try {
    const teamSnap = await db.collection("team").where("sportId", "==", sport).limit(260).get();
    const teamIdToDisplay = new Map();
    for (const tdoc of teamSnap.docs) {
      const td = tdoc.data() || {};
      const disp = String(td.name || td.displayName || "").trim();
      const ab = String(td.abbreviation || td.abbr || "").trim().toLowerCase();
      teamIdToDisplay.set(tdoc.id, { display: disp, abbrev: ab });
    }

    const snap = await db.collection("players").where("sportId", "==", sport).limit(2500).get();
    for (const doc of snap.docs) {
      const d = doc.data() || {};
      const espnRaw = d.espnAthleteId || d.espnId || d.espnPlayerId || d.playerId;
      const name = d.name;
      if (!name || !espnRaw || !/^\d+$/.test(String(espnRaw))) continue;
      const nk = normalizePlayerNameForMatch(name);
      if (!nk) continue;
      const teamKey = String(d.team || d.teamId || "").trim();
      const meta = teamIdToDisplay.get(teamKey) || {};
      const teamRaw = String(d.teamName || meta.display || teamKey || "").trim();
      const teamAbbrev = meta.abbrev || "";
      const entry = {
        espnId: String(espnRaw),
        displayName: String(name).trim(),
        teamRaw,
        teamNorm: normalizeTeamTokenForMatch(teamRaw),
        teamAbbrev,
      };
      const pushEntry = (key) => {
        if (!key) return;
        if (!byNormName.has(key)) byNormName.set(key, []);
        byNormName.get(key).push(entry);
      };
      pushEntry(nk);
      const parts = nk.split(/\s+/).filter((t) => t.length > 1);
      if (parts.length >= 2) {
        const lastFirst = `${parts[parts.length - 1]} ${parts[0]}`;
        if (lastFirst !== nk) pushEntry(lastFirst);
      }
      flat.push({ nk, ...entry, lastTok: nk.split(/\s+/).pop() || "" });
    }
  } catch (err) {
    console.warn("Roster lookup for prop matching failed:", err.message);
  }
  return { byNormName, flat };
}

function matchupTeamNormList(matchup) {
  const { away, home } = parseMatchupTeams(matchup);
  return [normalizeTeamTokenForMatch(away), normalizeTeamTokenForMatch(home)].filter(Boolean);
}

function rosterEntryMatchesMatchup(entry, matchupNorms) {
  if (!entry.teamNorm && !entry.teamRaw && !entry.teamAbbrev) return false;
  const nick = entry.teamRaw
    ? normalizeTeamTokenForMatch(entry.teamRaw.split(/\s+/).pop() || "")
    : "";
  const ab = entry.teamAbbrev ? normalizeTeamTokenForMatch(entry.teamAbbrev) : "";
  for (const m of matchupNorms) {
    if (!m) continue;
    if (entry.teamNorm && (m.includes(entry.teamNorm) || entry.teamNorm.includes(m))) return true;
    if (nick && (m.includes(nick) || nick.includes(m))) return true;
    if (ab && ab.length >= 2 && (m.includes(ab) || ab.includes(m))) return true;
  }
  return false;
}

function resolveEspnFromRoster(playerName, matchup, ctx) {
  if (!ctx || !playerName) return null;
  const norms = matchupTeamNormList(matchup);

  const pickFromCandidates = (cands) => {
    if (!cands?.length) return null;
    if (cands.length === 1) return cands[0].espnId;
    const teamHits = cands.filter((e) => rosterEntryMatchesMatchup(e, norms));
    if (teamHits.length === 1) return teamHits[0].espnId;
    const pool = teamHits.length ? teamHits : cands;
    if (pool.length === 1) return pool[0].espnId;
    const scored = pool.map((e) => ({
      e,
      score: tokenOverlapScore(playerName, e.displayName || ""),
    }));
    scored.sort((a, b) => b.score - a.score);
    if (scored[0].score >= 2 && scored[0].score > (scored[1]?.score ?? 0)) return scored[0].e.espnId;
    return null;
  };

  for (const key of expandPlayerNameMatchKeys(playerName)) {
    const id = pickFromCandidates(ctx.byNormName.get(key));
    if (id) return id;
  }

  const nk = normalizePlayerNameForMatch(playerName);
  const last = nk.split(/\s+/).pop();
  if (!last || last.length < 3) return null;
  const scoped = ctx.flat.filter((r) => r.lastTok === last && rosterEntryMatchesMatchup(r, norms));
  if (scoped.length === 1) return scoped[0].espnId;
  if (scoped.length > 1) {
    const id = pickFromCandidates(scoped);
    if (id) return id;
  }
  return null;
}

/** playerName + espnAthleteId from roster when possible; headshot = ESPN CDN only (clients use grey placeholder if absent). */
function enrichPlayerPropsWithHeadshots(prop, sport, rosterCtx = null) {
  const legs = Array.isArray(prop.playerProps) ? prop.playerProps : [];
  if (!legs.length) return prop;
  const matchup = prop.matchup || "";
  const next = legs.map((leg) => {
    let playerName = leg.playerName || extractPlayerNameFromLabel(leg.label);
    let espnAthleteId = leg.espnAthleteId;
    if (!espnAthleteId || !/^\d+$/.test(String(espnAthleteId))) {
      const fromRoster = resolveEspnFromRoster(playerName, matchup, rosterCtx);
      if (fromRoster) espnAthleteId = fromRoster;
    }
    const idOk = espnAthleteId && /^\d+$/.test(String(espnAthleteId));
    const existingH = String(leg.headshot || "").trim();
    const headshot = /^https?:\/\//i.test(existingH)
      ? existingH
      : idOk
        ? headshotUrlForLeg({ sport, espnAthleteId })
        : null;
    return {
      ...leg,
      playerName,
      espnAthleteId: idOk ? String(espnAthleteId) : leg.espnAthleteId || null,
      headshot,
    };
  });
  return { ...prop, playerProps: next };
}

async function pruneExpiredProps(sport) {
  const now = new Date();
  const snap = await db.collection("props").where("sport", "==", sport).limit(900).get();
  if (snap.empty) return 0;
  let deleted = 0;
  const batch = db.batch();
  for (const doc of snap.docs) {
    const data = doc.data() || {};
    if (shouldDeleteStoredProp(data, now)) {
      batch.delete(doc.ref);
      deleted += 1;
    }
  }
  if (deleted) await batch.commit();
  return deleted;
}

function formatMoneylineValue(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return null;
  return num > 0 ? `+${Math.trunc(num)}` : `${Math.trunc(num)}`;
}

function pickPreferredSportsbook(books = []) {
  for (const preferred of PREFERRED_BOOKMAKERS) {
    const match = books.find((book) => book.bookmakerKey === preferred);
    if (match) return match;
  }
  return books[0] || null;
}

function sportsbookPriority(bookKey = "") {
  const key = String(bookKey).toLowerCase();
  const idx = PREFERRED_BOOKMAKERS.indexOf(key);
  return idx === -1 ? 999 : idx;
}

function impliedProbability(americanOdds) {
  const odds = asNumber(americanOdds);
  if (odds == null || odds === 0) return null;
  if (odds > 0) return Number((100 / (odds + 100)).toFixed(4));
  return Number((Math.abs(odds) / (Math.abs(odds) + 100)).toFixed(4));
}

function spreadRange(books = []) {
  const lines = [];
  for (const book of books) {
    for (const line of book?.markets?.spread || []) {
      const val = asNumber(line.line);
      if (val != null) lines.push(val);
    }
  }
  if (!lines.length) return null;
  return {
    min: Number(Math.min(...lines).toFixed(1)),
    max: Number(Math.max(...lines).toFixed(1)),
    delta: Number((Math.max(...lines) - Math.min(...lines)).toFixed(2)),
  };
}

function moneylineSpread(books = []) {
  const odds = [];
  for (const book of books) {
    for (const line of book?.markets?.moneyline || []) {
      const val = asNumber(line.odds);
      if (val != null) odds.push(val);
    }
  }
  if (!odds.length) return null;
  return {
    min: Math.min(...odds),
    max: Math.max(...odds),
    delta: Math.max(...odds) - Math.min(...odds),
  };
}

function mapOddsApiEventToProp(event, sport, today) {
  const home = event.home_team || "Home";
  const away = event.away_team || "Away";
  const matchup = `${away} @ ${home}`;
  const books = [];

  for (const book of event.bookmakers || []) {
    const spreadMarket = (book.markets || []).find((m) => m.key === "spreads");
    const totalMarket = (book.markets || []).find((m) => m.key === "totals");
    const moneylineMarket = (book.markets || []).find((m) => m.key === "h2h");

    const homeSpread = spreadMarket?.outcomes?.find((o) => o.name === home);
    const awaySpread = spreadMarket?.outcomes?.find((o) => o.name === away);
    const homeMl = moneylineMarket?.outcomes?.find((o) => o.name === home);
    const awayMl = moneylineMarket?.outcomes?.find((o) => o.name === away);
    const overTotal = totalMarket?.outcomes?.find((o) => (o.name || "").toLowerCase() === "over");
    const underTotal = totalMarket?.outcomes?.find((o) => (o.name || "").toLowerCase() === "under");

    const spread = homeSpread?.point != null && awaySpread?.point != null
      ? `${home} ${normalizeHalfStep(homeSpread.point)} / ${away} ${normalizeHalfStep(awaySpread.point)}`
      : null;
    const total = overTotal?.point != null && underTotal?.point != null
      ? `O/U ${normalizeHalfStep(overTotal.point)}`
      : null;
    const moneyline = homeMl?.price != null && awayMl?.price != null
      ? `${home} ${formatMoneylineValue(homeMl.price)} / ${away} ${formatMoneylineValue(awayMl.price)}`
      : null;

    books.push({
      bookmakerKey: book.key,
      bookmakerName: book.title,
      markets: {
        moneyline: [
          {
            side: home,
            odds: homeMl?.price ?? null,
            impliedProbability: homeMl?.price ? Number((100 / (Math.abs(homeMl.price) + 100)).toFixed(4)) : null,
          },
          {
            side: away,
            odds: awayMl?.price ?? null,
            impliedProbability: awayMl?.price ? Number((100 / (Math.abs(awayMl.price) + 100)).toFixed(4)) : null,
          },
        ],
        spread: [
          {
            side: home,
            line: homeSpread?.point != null ? Number(normalizeHalfStep(homeSpread.point)) : null,
            odds: homeSpread?.price ?? null,
          },
          {
            side: away,
            line: awaySpread?.point != null ? Number(normalizeHalfStep(awaySpread.point)) : null,
            odds: awaySpread?.price ?? null,
          },
        ],
        total: [
          {
            side: "Over",
            line: overTotal?.point != null ? Number(normalizeHalfStep(overTotal.point)) : null,
            odds: overTotal?.price ?? null,
          },
          {
            side: "Under",
            line: underTotal?.point != null ? Number(normalizeHalfStep(underTotal.point)) : null,
            odds: underTotal?.price ?? null,
          },
        ],
      },
      spread,
      total,
      moneyline,
      playerProps: [],
      lastUpdate: book.last_update || event.commence_time || null,
    });
  }

  const preferred = pickPreferredSportsbook(books);
  const spread = preferred?.spread || null;
  const total = preferred?.total || null;
  const moneyline = preferred?.moneyline || null;
  const playerProps = Array.isArray(preferred?.playerProps) ? preferred.playerProps.slice(0, 40) : [];
  const range = spreadRange(books);
  const mlMove = moneylineSpread(books);
  const bestMoneyline = preferred?.markets?.moneyline?.map((x) => ({
    side: x.side,
    odds: x.odds,
    impliedProbability: impliedProbability(x.odds),
  })) || [];

  return {
    eventId: event.id || null,
    sport,
    matchup,
    spread: spread || "N/A",
    moneyline: moneyline || "N/A",
    total: total || "N/A",
    date: today,
    source: "odds_api",
    commenceTime: event.commence_time || null,
    availableBooks: books.map((b) => b.bookmakerKey),
    preferredBook: preferred
      ? {
          bookmakerKey: preferred.bookmakerKey,
          bookmakerName: preferred.bookmakerName,
        }
      : null,
    analytics: {
      spreadRange: range,
      moneylineRange: mlMove,
      booksCount: books.length,
      hasPlayerProps: playerProps.length > 0,
      bestMoneyline,
    },
    books,
    playerProps,
  };
}

function mapEventPlayerProps(payload, sport = "nba") {
  const maxPerBook = envPositiveInt("ODDS_API_MAX_PLAYER_PROPS_PER_BOOK", 800, 3000);
  const byBook = new Map();
  for (const book of payload?.bookmakers || []) {
    const props = [];
    for (const market of book.markets || []) {
      for (const outcome of market.outcomes || []) {
        const label = outcome.description || outcome.name || "Pick";
        const playerName = extractPlayerNameFromLabel(label);
        const espnAthleteId = outcome.id || outcome.participant_id || outcome.participantId || null;
        props.push({
          market: market.key,
          label,
          side: outcome.name || null,
          line: outcome.point != null ? Number(normalizeHalfStep(outcome.point)) : null,
          odds: outcome.price ?? null,
          bookKey: book.key || null,
          bookName: book.title || null,
          playerName,
          espnAthleteId,
          headshot: headshotUrlForLeg({ sport, espnAthleteId }),
        });
      }
    }
    byBook.set(book.key, {
      bookmakerKey: book.key,
      bookmakerName: book.title,
      playerProps: props.slice(0, maxPerBook),
    });
  }
  return byBook;
}

function mergePlayerPropsMaps(target, incoming) {
  for (const [bookKey, propBlock] of incoming.entries()) {
    const current = target.get(bookKey) || {
      bookmakerKey: propBlock.bookmakerKey,
      bookmakerName: propBlock.bookmakerName,
      playerProps: [],
    };
    current.playerProps.push(...(propBlock.playerProps || []));
    target.set(bookKey, current);
  }
}

function dedupeAndCapBookProps(props = []) {
  const maxPerBook = envPositiveInt("ODDS_API_MAX_PLAYER_PROPS_PER_BOOK", 800, 3000);
  const seen = new Set();
  const deduped = [];
  for (const prop of props) {
    const key = [
      String(prop.market || "").toLowerCase(),
      String(prop.label || "").toLowerCase(),
      String(prop.side || "").toLowerCase(),
      prop.line ?? "",
      prop.odds ?? "",
    ].join("|");
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(prop);
    if (deduped.length >= maxPerBook) break;
  }
  return deduped;
}

async function requestEventPropPayloads({ eventUrl, headers = {}, paramsBase = {}, markets = [] }) {
  const uniqueMarkets = Array.from(new Set((markets || []).filter(Boolean)));
  if (!uniqueMarkets.length) return [];

  try {
    const { data } = await requestWithRetry({
      method: "GET",
      url: eventUrl,
      headers,
      params: { ...paramsBase, markets: uniqueMarkets.join(",") },
      timeout: 12000,
    });
    return [data];
  } catch (err) {
    const status = err?.response?.status;
    if (status !== 400 && status !== 422) throw err;
  }

  const batchSize = envPositiveInt("ODDS_API_PLAYER_MARKET_BATCH_SIZE", 6, 20);
  const chunks = chunkArray(uniqueMarkets, batchSize);
  const payloads = [];
  for (const group of chunks) {
    try {
      const { data } = await requestWithRetry({
        method: "GET",
        url: eventUrl,
        headers,
        params: { ...paramsBase, markets: group.join(",") },
        timeout: 12000,
      });
      payloads.push(data);
    } catch (err) {
      const status = err?.response?.status;
      if ((status === 400 || status === 422) && group.length > 1) {
        for (const market of group) {
          try {
            const { data } = await requestWithRetry({
              method: "GET",
              url: eventUrl,
              headers,
              params: { ...paramsBase, markets: market },
              timeout: 12000,
            });
            payloads.push(data);
          } catch {
            // Ignore unsupported markets for this sport/book.
          }
        }
      }
    }
  }
  return payloads;
}

function combinePlayerPropsAcrossBooks(books = []) {
  const maxPerEvent = envPositiveInt("ODDS_API_MAX_PLAYER_PROPS_PER_EVENT", 1400, 5000);
  const byKey = new Map();

  for (const book of books) {
    const bkFallback = book?.bookmakerKey || "";
    const bnFallback = book?.bookmakerName || "";
    for (const prop of book?.playerProps || []) {
      const key = [
        prop.market || "",
        String(prop.label || "").toLowerCase(),
        String(prop.side || "").toLowerCase(),
        prop.line ?? "",
      ].join("|");
      const quote = {
        bookKey: prop.bookKey || bkFallback || null,
        bookName: prop.bookName || bnFallback || null,
        odds: prop.odds ?? null,
      };
      if (!byKey.has(key)) {
        byKey.set(key, {
          ...prop,
          bookKey: quote.bookKey,
          bookName: quote.bookName,
          odds: prop.odds,
          bookQuotes: [quote],
        });
      } else {
        const agg = byKey.get(key);
        const dup = agg.bookQuotes.some(
          (q) =>
            String(q.bookKey || "") === String(quote.bookKey || "") && Number(q.odds ?? "") === Number(quote.odds ?? "")
        );
        if (!dup) agg.bookQuotes.push(quote);
      }
    }
  }

  const merged = Array.from(byKey.values());
  for (const leg of merged) {
    const qs = Array.isArray(leg.bookQuotes) ? leg.bookQuotes : [];
    qs.sort((a, b) => {
      const ap = sportsbookPriority(a.bookKey);
      const bp = sportsbookPriority(b.bookKey);
      if (ap !== bp) return ap - bp;
      const ao = Number(a.odds);
      const bo = Number(b.odds);
      if (Number.isFinite(ao) && Number.isFinite(bo) && ao !== bo) return bo - ao;
      return 0;
    });
    leg.bookQuotes = qs;
    const primary = qs[0];
    if (primary) {
      leg.bookKey = primary.bookKey;
      leg.bookName = primary.bookName;
      leg.odds = primary.odds;
    }
  }

  merged.sort((a, b) => {
    const aP = sportsbookPriority(a.bookKey);
    const bP = sportsbookPriority(b.bookKey);
    if (aP !== bP) return aP - bP;
    return String(a.label || "").localeCompare(String(b.label || ""));
  });

  return merged.slice(0, maxPerEvent);
}

function slimBooksForStorage(books = []) {
  return books.map((book) => ({
    bookmakerKey: book.bookmakerKey || null,
    bookmakerName: book.bookmakerName || null,
    markets: {
      moneyline: Array.isArray(book?.markets?.moneyline) ? book.markets.moneyline : [],
      spread: Array.isArray(book?.markets?.spread) ? book.markets.spread : [],
      total: Array.isArray(book?.markets?.total) ? book.markets.total : [],
    },
    spread: book.spread || null,
    total: book.total || null,
    moneyline: book.moneyline || null,
    playerProps: [],
    lastUpdate: book.lastUpdate || null,
  }));
}

async function fetchPropsFromOddsApi({
  sport,
  today,
  allEventProps = false,
  eventPropLimit = 10,
  propMarketTier = null,
}) {
  const oddsKey = process.env.ODDS_API_KEY;
  const sportKey = SPORT_ODDS_KEYS[sport];
  if (!oddsKey || !sportKey) return null;

  const requestedBookmakers = configuredBookmakers();
  const regions = oddsApiRegionsParam();

  const url = `https://api.the-odds-api.com/v4/sports/${sportKey}/odds`;
  const { data } = await requestWithRetry({
    method: "GET",
    url,
    params: {
      apiKey: oddsKey,
      regions,
      markets: CORE_MARKETS.join(","),
      oddsFormat: "american",
      ...(requestedBookmakers.length ? { bookmakers: requestedBookmakers.join(",") } : {}),
    },
    timeout: 12000,
  });

  if (!Array.isArray(data)) return [];
  const mapped = data.map((event) => mapOddsApiEventToProp(event, sport, today));

  const tier = propMarketTier || propMarketTierFromEnv();
  const propMarkets = resolvePlayerPropMarketsForSport(sport, tier);
  if (!propMarkets.length) return mapped.map(({ eventId, ...rest }) => rest);

  const maxEvents = allEventProps ? mapped.length : Math.max(1, eventPropLimit);
  const target = mapped.slice(0, Math.max(0, maxEvents)).filter((e) => e.eventId);
  const concurrency = Math.max(1, Number(process.env.ODDS_API_PROP_CONCURRENCY || 4));
  for (let idx = 0; idx < target.length; idx += concurrency) {
    const chunk = target.slice(idx, idx + concurrency);
    const settled = await Promise.allSettled(
      chunk.map(async (eventItem) => {
        const eventUrl = `https://api.the-odds-api.com/v4/sports/${sportKey}/events/${eventItem.eventId}/odds`;
        const payloads = await requestEventPropPayloads({
          eventUrl,
          paramsBase: {
            apiKey: oddsKey,
            regions,
            oddsFormat: "american",
            ...(requestedBookmakers.length ? { bookmakers: requestedBookmakers.join(",") } : {}),
          },
          markets: propMarkets,
        });
        if (!payloads.length) return;

        const mergedByBook = new Map();
        for (const payload of payloads) {
          mergePlayerPropsMaps(mergedByBook, mapEventPlayerProps(payload, sport));
        }

        for (const [bookKey, propBlock] of mergedByBook.entries()) {
          const normalizedProps = dedupeAndCapBookProps(propBlock.playerProps);
          const existing = eventItem.books.find((b) => b.bookmakerKey === bookKey);
          if (existing) {
            existing.playerProps = normalizedProps;
          } else {
            eventItem.books.push({
              bookmakerKey: propBlock.bookmakerKey,
              bookmakerName: propBlock.bookmakerName,
              markets: { moneyline: [], spread: [], total: [] },
              spread: null,
              total: null,
              moneyline: null,
              playerProps: normalizedProps,
              lastUpdate: eventItem.commenceTime || null,
            });
          }
        }

        const preferred = pickPreferredSportsbook(eventItem.books);
        eventItem.playerProps = combinePlayerPropsAcrossBooks(eventItem.books);
        eventItem.availableBooks = eventItem.books.map((b) => b.bookmakerKey);
        eventItem.preferredBook = preferred
          ? {
              bookmakerKey: preferred.bookmakerKey,
              bookmakerName: preferred.bookmakerName,
            }
          : null;
        eventItem.analytics = {
          ...(eventItem.analytics || {}),
          hasPlayerProps: eventItem.playerProps.length > 0,
          playerPropsCount: eventItem.playerProps.length,
        };
      })
    );
    // no-op, we keep core markets even if event prop calls fail.
    settled.forEach(() => {});
  }

  return mapped.map(({ eventId, ...rest }) => rest);
}

async function fetchPropsFromRapidApi({
  sport,
  today,
  allEventProps = false,
  eventPropLimit = 10,
  propMarketTier = null,
}) {
  const cfg = rapidApiConfig();
  const sportKey = SPORT_ODDS_KEYS[sport];
  if (!cfg.enabled || !sportKey) return null;

  const requestedBookmakers = configuredBookmakers();
  const regions = oddsApiRegionsParam();
  const url = `${cfg.baseUrl}/v4/sports/${sportKey}/odds`;
  const { data } = await requestWithRetry({
    method: "GET",
    url,
    headers: {
      "x-rapidapi-key": cfg.key,
      "x-rapidapi-host": cfg.host,
    },
    params: {
      regions,
      markets: CORE_MARKETS.join(","),
      oddsFormat: "american",
      ...(requestedBookmakers.length ? { bookmakers: requestedBookmakers.join(",") } : {}),
    },
    timeout: 12000,
  });

  if (!Array.isArray(data)) return [];
  const mapped = data.map((event) => mapOddsApiEventToProp(event, sport, today));
  const tier = propMarketTier || propMarketTierFromEnv();
  const propMarkets = resolvePlayerPropMarketsForSport(sport, tier);
  if (!propMarkets.length) return mapped.map(({ eventId, ...rest }) => rest);

  const maxEvents = allEventProps ? mapped.length : Math.max(1, eventPropLimit);
  const target = mapped.slice(0, Math.max(0, maxEvents)).filter((e) => e.eventId);
  const concurrency = Math.max(1, Number(process.env.ODDS_API_PROP_CONCURRENCY || 4));
  for (let idx = 0; idx < target.length; idx += concurrency) {
    const chunk = target.slice(idx, idx + concurrency);
    const settled = await Promise.allSettled(
      chunk.map(async (eventItem) => {
        const eventUrl = `${cfg.baseUrl}/v4/sports/${sportKey}/events/${eventItem.eventId}/odds`;
        const payloads = await requestEventPropPayloads({
          eventUrl,
          headers: {
            "x-rapidapi-key": cfg.key,
            "x-rapidapi-host": cfg.host,
          },
          paramsBase: {
            regions,
            oddsFormat: "american",
            ...(requestedBookmakers.length ? { bookmakers: requestedBookmakers.join(",") } : {}),
          },
          markets: propMarkets,
        });
        if (!payloads.length) return;

        const mergedByBook = new Map();
        for (const payload of payloads) {
          mergePlayerPropsMaps(mergedByBook, mapEventPlayerProps(payload, sport));
        }
        for (const [bookKey, propBlock] of mergedByBook.entries()) {
          const normalizedProps = dedupeAndCapBookProps(propBlock.playerProps);
          const existing = eventItem.books.find((b) => b.bookmakerKey === bookKey);
          if (existing) {
            existing.playerProps = normalizedProps;
          } else {
            eventItem.books.push({
              bookmakerKey: propBlock.bookmakerKey,
              bookmakerName: propBlock.bookmakerName,
              markets: { moneyline: [], spread: [], total: [] },
              spread: null,
              total: null,
              moneyline: null,
              playerProps: normalizedProps,
              lastUpdate: eventItem.commenceTime || null,
            });
          }
        }

        const preferred = pickPreferredSportsbook(eventItem.books);
        eventItem.playerProps = combinePlayerPropsAcrossBooks(eventItem.books);
        eventItem.availableBooks = eventItem.books.map((b) => b.bookmakerKey);
        eventItem.preferredBook = preferred
          ? {
              bookmakerKey: preferred.bookmakerKey,
              bookmakerName: preferred.bookmakerName,
            }
          : null;
        eventItem.analytics = {
          ...(eventItem.analytics || {}),
          hasPlayerProps: eventItem.playerProps.length > 0,
          playerPropsCount: eventItem.playerProps.length,
        };
      })
    );
    settled.forEach(() => {});
  }

  return mapped.map(({ eventId, ...rest }) => rest);
}

async function fetchPropsFromEspnFallback({ sport, today, url }) {
  const { data } = await requestWithRetry({
    method: "GET",
    url,
    headers: { "User-Agent": "Mozilla/5.0" },
    timeout: 12000,
  });

  const $ = cheerio.load(data);
  const props = [];

  $("table").each((_, table) => {
    const rows = $(table).find("tbody tr");
    rows.each((_, row) => {
      const cells = $(row).find("td");
      if (cells.length < 4) return;

      const matchup = $(cells[0]).text().trim();
      const spread = sanitizeMarketText($(cells[1]).text().trim());
      const moneyline = $(cells[2]).text().trim();
      const total = sanitizeMarketText($(cells[3]).text().trim());
      if (!matchup) return;

      props.push({
        sport,
        matchup,
        spread,
        moneyline,
        total,
        date: today,
        source: "espn_fallback",
        availableBooks: [],
        books: [],
      });
    });
  });

  return props;
}

async function fetchPropsFromScoreboardFallback({ sport, today }) {
  const endpoint = SCOREBOARD_ENDPOINTS[sport];
  if (!endpoint) return [];
  const { data } = await requestWithRetry({ method: "GET", url: endpoint, timeout: 12000 });
  const events = Array.isArray(data?.events) ? data.events : [];
  const props = [];

  for (const event of events) {
    const comp = event?.competitions?.[0] || {};
    const home = (comp.competitors || []).find((c) => c.homeAway === "home")?.team?.displayName || "Home";
    const away = (comp.competitors || []).find((c) => c.homeAway === "away")?.team?.displayName || "Away";
    const oddsObj = comp.odds?.[0] || {};

    const spreadValue = Number(oddsObj.spread);
    const totalValue = Number(oddsObj.overUnder);
    const homeMl = oddsObj.homeTeamOdds?.moneyLine;
    const awayMl = oddsObj.awayTeamOdds?.moneyLine;

    const spread = Number.isFinite(spreadValue)
      ? `${home} ${normalizeHalfStep(spreadValue)} / ${away} ${normalizeHalfStep(-spreadValue)}`
      : sanitizeMarketText(oddsObj.details || "N/A");
    const total = Number.isFinite(totalValue) ? `O/U ${normalizeHalfStep(totalValue)}` : "N/A";
    const moneyline =
      homeMl != null && awayMl != null
        ? `${home} ${formatMoneylineValue(homeMl)} / ${away} ${formatMoneylineValue(awayMl)}`
        : "N/A";

    props.push({
      sport,
      matchup: `${away} @ ${home}`,
      spread,
      moneyline,
      total,
      date: today,
      source: "scoreboard_fallback",
      commenceTime: event?.date || null,
      availableBooks: [],
      books: [],
    });
  }

  return props;
}

export const handler = async (event) => {
  const query = event?.queryStringParameters || {};
  const sport = query.sport?.toLowerCase() || "nba";
  const today = new Date().toISOString().split("T")[0];
  const requestedDayKey = query.date ? ymd(query.date) : null;
  const includeBooks = String(query.includeBooks || "0") !== "0";
  // Default paid: a configured ODDS_API_KEY without explicit ODDS_API_PLAN_MODE=free should
  // unlock full-slate fetches (Max Coverage / allEventProps) — free-tier keys set `free` explicitly.
  const planMode = String(process.env.ODDS_API_PLAN_MODE || "paid").toLowerCase();
  const paidMode = planMode === "paid" || planMode === "trial";
  const allEventProps = paidMode ? String(query.allEventProps || "0") === "1" : false;
  const forceLive = String(query.forceLive || "0") === "1";
  const tunedDefault = recommendedEventPropLimit(sport, planMode);
  // `tunedDefault` is a planning figure from coverageTuning; use it as a floor and expand the
  // number of events we enrich with player props so paid keys surface full matrices (still capped in combinePlayerPropsAcrossBooks).
  const defaultEventPropLimit = paidMode ? Math.max(40, tunedDefault) : Math.max(12, tunedDefault);
  const eventPropLimit = envPositiveInt("ODDS_API_EVENT_PROP_LIMIT", Number(query.eventPropLimit || defaultEventPropLimit), 500);
  const windowDays = envPositiveInt("PROPS_WINDOW_DAYS_DEFAULT", Number(query.windowDays || 3), 7);
  const liveCacheTtlSec = envPositiveInt("PROPS_LIVE_CACHE_TTL_SECONDS", 72, 600);
  const propMarketTier = propMarketTierFromEnv();
  const propMarketMeta = propMarketTierMeta(propMarketTier);

  if (sport === "all") {
    const settled = await Promise.allSettled(
      SPORT_LIST.map((s) =>
        handler({
          queryStringParameters: {
            ...query,
            sport: s,
          },
        })
      )
    );

    const props = [];
    const failedSports = [];
    const sourceMix = {};
    const budget = {};
    for (let i = 0; i < settled.length; i += 1) {
      const label = SPORT_LIST[i];
      const result = settled[i];
      if (result.status !== "fulfilled") {
        failedSports.push(label);
        continue;
      }
      try {
        const payload = JSON.parse(result.value.body || "{}");
        if (Array.isArray(payload.props)) {
          props.push(...payload.props);
          const src = payload.source || "mixed";
          sourceMix[src] = (sourceMix[src] || 0) + 1;
          if (payload.budget && typeof payload.budget === "object") {
            Object.assign(budget, payload.budget);
          }
        } else {
          failedSports.push(label);
        }
      } catch {
        failedSports.push(label);
      }
    }

    const normalizedAll = props.map((p) => {
      const src = p.source || "mixed";
      const confidence = Number.isFinite(Number(p.confidence)) ? Number(p.confidence) : computePropConfidence(p, src);
      const band = p.confidenceBand || confidenceBand(confidence);
      const analytics = p.analytics && p.analytics.reliabilityScore != null
        ? p.analytics
        : enrichDerivedAnalytics(p, src);
      return {
        ...p,
        confidence,
        confidenceBand: band,
        analytics,
      };
    });

    return {
      statusCode: 200,
      body: JSON.stringify({
        sport: "all",
        mode: "props",
        count: normalizedAll.length,
        totalPlayerProps: normalizedAll.reduce((sum, p) => sum + ((p.playerProps || []).length || 0), 0),
        failedSports,
        generatedAt: new Date().toISOString(),
        booksRequested: configuredBookmakers().length ? configuredBookmakers() : "all_us_region",
        coverage: {
          planMode,
          allEventProps,
          windowDays,
          eventPropLimit: allEventProps ? "all_events" : eventPropLimit,
          eventsWithPlayerProps: normalizedAll.filter((p) => (p.playerProps || []).length > 0).length,
          totalPlayerProps: normalizedAll.reduce((sum, p) => sum + ((p.playerProps || []).length || 0), 0),
          propMarketTier,
          propMarkets: propMarketMeta,
          tuning: coverageGuidancePayload("all", planMode, eventPropLimit, windowDays, liveCacheTtlSec, "multi_sport"),
          quotaPlanning: buildQuotaPlanningReport({
            sports: SPORT_LIST,
            planMode,
            cacheTtlSeconds: liveCacheTtlSec,
            booksConfigured: configuredBookmakers().length || 6,
          }),
        },
        reliability: {
          sourceMix,
          avgReliability: normalizedAll.length
            ? Math.round(
                normalizedAll.reduce((sum, p) => sum + Number(p?.analytics?.reliabilityScore || 0), 0) / normalizedAll.length
              )
            : 0,
        },
        budget,
        props: normalizedAll,
      }),
    };
  }

  console.log(`📡 /props Lambda hit | sport: ${sport} | date: ${today}`);

  let url = null;

  switch (sport) {
    case "nba":
      url = "https://www.espn.com/nba/lines";
      break;
    case "mlb":
      url = "https://www.espn.com/mlb/lines";
      break;
    case "nfl":
      url = "https://www.espn.com/nfl/lines";
      break;
    case "wnba":
      url = "https://www.espn.com/wnba/lines";
      break;
    default:
      console.warn(`⚠️ Invalid sport: ${sport}`);
      return {
        statusCode: 400,
        body: JSON.stringify({ error: "Invalid sport" }),
      };
  }

  if (requestedDayKey && isHistoricalDate(requestedDayKey)) {
    try {
      const historical = await readPropHistoryByDay(sport, requestedDayKey, includeBooks, 1200);
      const totalPlayerProps = historical.reduce((sum, p) => sum + ((p.playerProps || []).length || 0), 0);
      return {
        statusCode: 200,
        body: JSON.stringify({
          sport,
          mode: "props",
          count: historical.length,
          totalPlayerProps,
          source: "history_cache",
          generatedAt: new Date().toISOString(),
          warning: historical.length ? null : "No historical rows for requested date.",
          coverage: {
            requestedDate: requestedDayKey,
            fromMemoryStore: true,
          },
          props: historical,
        }),
      };
    } catch (historyErr) {
      console.error("❌ Historical props read failed:", historyErr.message);
    }
  }

  try {
    if (!forceLive) {
      const cached = await readPropsCache(sport);
      if (cached?.props?.length && cacheIsFresh(cached.cachedAtIso, liveCacheTtlSec)) {
        const filtered = filterPropsToWindow(cached.props, windowDays).map((p) => ({
          ...p,
          books: includeBooks ? (Array.isArray(p.books) ? p.books : []) : [],
        }));
        const cachedLegTotal = filtered.reduce((sum, p) => sum + ((p.playerProps || []).length || 0), 0);
        const minLegsToTrustCache = paidMode ? Math.max(100, Math.min(400, filtered.length * 8)) : 18;
        if (cachedLegTotal >= minLegsToTrustCache) {
          return {
            statusCode: 200,
            body: JSON.stringify({
              sport,
              mode: "props",
              count: filtered.length,
              totalPlayerProps: cachedLegTotal,
              source: "live_cache",
              generatedAt: new Date().toISOString(),
              cachedAt: cached.cachedAt || null,
              cachedAtIso: cached.cachedAtIso || null,
              warning: null,
              coverage: {
                planMode,
                allEventProps,
                windowDays,
                eventPropLimit: allEventProps ? "all_events" : eventPropLimit,
                cacheTtlSeconds: liveCacheTtlSec,
                propMarketTier,
                propMarkets: propMarketMeta,
                tuning: coverageGuidancePayload(sport, planMode, eventPropLimit, windowDays, liveCacheTtlSec, "live_cache"),
              },
              props: filtered,
            }),
          };
        }
        console.warn(
          `props cache ${sport}: skipping stale-density cache (legs=${cachedLegTotal}, min=${minLegsToTrustCache}); refreshing live`,
        );
      }
    }

    let props = [];
    let source = "espn_fallback";
    let warning = null;
    const rapidCfg = rapidApiConfig();
    const budget = {};

    // Primary provider: direct Odds API.
    try {
      const oddsBudget = await allowLiveCall({
        provider: "odds_api",
        sport,
        kind: "props",
        surface: "web_api",
      });
      budget.oddsApi = oddsBudget;
      if (oddsBudget.allowed) {
        const multiBookProps = await fetchPropsFromOddsApi({
          sport,
          today,
          allEventProps,
          eventPropLimit,
          propMarketTier,
        });
        if (multiBookProps && multiBookProps.length > 0) {
          props = multiBookProps;
          source = "odds_api";
        }
      } else {
        warning = `Odds API paused by budget guard (${oddsBudget.reason}).`;
      }
    } catch (oddsErr) {
      const code = oddsErr?.response?.status || "n/a";
      const details = oddsErr?.response?.data?.message || oddsErr?.response?.data?.error_code || "";
      warning = `Odds API unavailable, used fallback: ${oddsErr.message} (status: ${code}${details ? `, details: ${details}` : ""})`;
    }

    if (!props.length && rapidCfg.enabled) {
      try {
        const rapidBudget = await allowLiveCall({
          provider: "rapidapi_odds",
          sport,
          kind: "props",
          surface: "web_api",
        });
        budget.rapidApi = rapidBudget;
        if (rapidBudget.allowed) {
          const rapidProps = await fetchPropsFromRapidApi({
            sport,
            today,
            allEventProps,
            eventPropLimit,
            propMarketTier,
          });
          if (rapidProps && rapidProps.length > 0) {
            props = rapidProps;
            source = "rapidapi_odds";
            warning = warning
              ? `${warning} Recovered via RapidAPI provider.`
              : "Primary provider unavailable; recovered via RapidAPI provider.";
          }
        } else {
          const rapidMsg = `RapidAPI paused by budget guard (${rapidBudget.reason}).`;
          warning = warning ? `${warning} ${rapidMsg}` : rapidMsg;
        }
      } catch (rapidErr) {
        const rCode = rapidErr?.response?.status || "n/a";
        const rDetails = rapidErr?.response?.data?.message || rapidErr?.response?.data?.error || "";
        const msg = `RapidAPI fallback unavailable: ${rapidErr.message} (status: ${rCode}${rDetails ? `, details: ${rDetails}` : ""})`;
        warning = warning ? `${warning} ${msg}` : msg;
      }
    }

    if (!props.length) {
      props = await fetchPropsFromEspnFallback({ sport, today, url });
      source = "espn_fallback";
      if (!process.env.ODDS_API_KEY) {
        warning = "ODDS_API_KEY missing; using ESPN fallback (single-source).";
      }
    }

    if (!props.length) {
      props = await fetchPropsFromScoreboardFallback({ sport, today });
      source = "scoreboard_fallback";
      warning = (warning ? `${warning} ` : "") + "No lines table found; used ESPN scoreboard fallback.";
    }

    if (!props.length) {
      const snap = await db.collection("props").where("sport", "==", sport).limit(200).get();
      props = snap.docs.map((doc) => {
        const item = doc.data() || {};
        return {
          sport,
          matchup: item.matchup || "",
          spread: sanitizeMarketText(item.spread || "N/A"),
          moneyline: item.moneyline || "N/A",
          total: sanitizeMarketText(item.total || "N/A"),
          date: item.date || today,
          source: item.source || "firestore_cache",
          availableBooks: Array.isArray(item.availableBooks) ? item.availableBooks : [],
          books: Array.isArray(item.books) ? item.books : [],
          preferredBook: item.preferredBook || null,
          analytics: item.analytics || null,
          playerProps: Array.isArray(item.playerProps) ? item.playerProps : [],
        };
      });
      if (props.length) {
        source = "firestore_cache";
        warning = (warning ? `${warning} ` : "") + "No fresh provider props; returned cached props.";
      }
    }

    props = filterPropsToWindow(props, windowDays);

    try {
      props = await enrichPropsWithEntityResolution(props, sport);
    } catch (e) {
      console.warn("entity resolution skipped:", e.message || e);
    }

    console.log(`📊 Scraped ${props.length} props for ${sport.toUpperCase()} via ${source}`);

    const rosterCtx = await buildPlayerRosterMatchContext(sport);

    let enriched = props.map((p) => {
      const cleaned = stripSyntheticPlayerLegs(p);
      const faced = enrichPlayerPropsWithHeadshots(cleaned, sport, rosterCtx);
      return {
        ...faced,
        books: Array.isArray(faced.books) ? faced.books : [],
        analytics: enrichDerivedAnalytics(faced, source),
        confidence: computePropConfidence(faced, source),
        confidenceBand: confidenceBand(computePropConfidence(faced, source)),
        tags: [
          faced.analytics?.hasPlayerProps ? "player_props" : "core_markets",
          faced.availableBooks?.length ? "multi_book" : "single_source",
          source,
        ],
      };
    });
    let responseProps = enriched.map((p) => ({
      ...p,
      books: includeBooks ? p.books : [],
    }));
    let totalPlayerProps = responseProps.reduce((sum, p) => sum + ((p.playerProps || []).length || 0), 0);

    if (!totalPlayerProps && source !== "odds_api" && source !== "rapidapi_odds") {
      const cached = await readPropsCache(sport);
      const cachedProps = Array.isArray(cached?.props) ? cached.props : [];
      const cachedTotal = cachedProps.reduce((sum, p) => sum + ((p.playerProps || []).length || 0), 0);
      if (cachedTotal > 0) {
        const filteredCached = filterPropsToWindow(cachedProps, windowDays);
        const filteredCachedTotal = filteredCached.reduce((sum, p) => sum + ((p.playerProps || []).length || 0), 0);
        if (filteredCachedTotal > 0) {
          props = filteredCached;
          totalPlayerProps = filteredCachedTotal;
          source = "stale_cache";
          warning = warning
            ? `${warning} Live provider had no player props; returned richer cached props.`
            : "Live provider had no player props; returned richer cached props.";
          enriched = props.map((p) => {
            const cleaned = stripSyntheticPlayerLegs(p);
            const faced = enrichPlayerPropsWithHeadshots(cleaned, sport, rosterCtx);
            return {
              ...faced,
              books: Array.isArray(faced.books) ? faced.books : [],
              analytics: enrichDerivedAnalytics(faced, source),
              confidence: computePropConfidence(faced, source),
              confidenceBand: confidenceBand(computePropConfidence(faced, source)),
              tags: [
                faced.analytics?.hasPlayerProps ? "player_props" : "core_markets",
                faced.availableBooks?.length ? "multi_book" : "single_source",
                source,
              ],
            };
          });
          responseProps = enriched.map((p) => ({
            ...p,
            books: includeBooks ? p.books : [],
          }));
        }
      } else {
        const historicalRich = await readRichPropsFromFirestore(sport, 600);
        const historicalTotal = historicalRich.reduce((sum, p) => sum + ((p.playerProps || []).length || 0), 0);
        if (historicalTotal > 0) {
          const filteredHistorical = filterPropsToWindow(historicalRich, windowDays);
          const filteredHistoricalTotal = filteredHistorical.reduce((sum, p) => sum + ((p.playerProps || []).length || 0), 0);
          if (filteredHistoricalTotal > 0) {
            props = filteredHistorical;
            totalPlayerProps = filteredHistoricalTotal;
            source = "firestore_cache";
            warning = warning
              ? `${warning} Live provider had no player props; returned richer historical cache from Firestore.`
              : "Live provider had no player props; returned richer historical cache from Firestore.";
            enriched = props.map((p) => {
              const cleaned = stripSyntheticPlayerLegs(p);
              const faced = enrichPlayerPropsWithHeadshots(cleaned, sport, rosterCtx);
              return {
                ...faced,
                books: Array.isArray(faced.books) ? faced.books : [],
                analytics: enrichDerivedAnalytics(faced, source),
                confidence: computePropConfidence(faced, source),
                confidenceBand: confidenceBand(computePropConfidence(faced, source)),
                tags: [
                  faced.analytics?.hasPlayerProps ? "player_props" : "core_markets",
                  faced.availableBooks?.length ? "multi_book" : "single_source",
                  source,
                ],
              };
            });
            responseProps = enriched.map((p) => ({
              ...p,
              books: includeBooks ? p.books : [],
            }));
          }
        }
      }
    }

    // Save to Firestore in batches (faster and less write overhead).
    const writeBatchSize = 350;
    for (let i = 0; i < enriched.length; i += writeBatchSize) {
      const chunk = enriched.slice(i, i + writeBatchSize);
      const batch = db.batch();
      for (const prop of chunk) {
        const safeMatchup = String(prop.matchup || "unknown")
          .replace(/[^a-zA-Z0-9_-]+/g, "_")
          .slice(0, 140);
        const docId = `${sport}_${safeMatchup}_${today}`;
        batch.set(
          db.collection("props").doc(docId),
          {
            ...prop,
            // Keep stored books slim; avoids massive doc payloads from full prop trees.
            books: slimBooksForStorage(Array.isArray(prop.books) ? prop.books : []),
            source,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          },
          { merge: true }
        );
      }
      await batch.commit();
    }

    const historySnapshots = await writePropHistorySnapshots(sport, enriched);
    const clvTimelineSamples = await writeClvTimelineSamples(sport, enriched);
    const deletedExpired = await pruneExpiredProps(sport);

    if (source === "odds_api" || source === "rapidapi_odds" || totalPlayerProps > 0) {
      await writePropsCache(sport, { props: enriched, source });
    }

    return {
      statusCode: 200,
      body: JSON.stringify({
        sport,
        mode: "props",
        count: responseProps.length,
        totalPlayerProps,
        source,
        generatedAt: new Date().toISOString(),
        booksRequested: configuredBookmakers().length ? configuredBookmakers() : "all_us_region",
        warning,
        coverage: {
          planMode,
          allEventProps,
          windowDays,
          eventPropLimit: allEventProps ? "all_events" : eventPropLimit,
          eventCount: responseProps.length,
          eventsWithPlayerProps: responseProps.filter((p) => (p.playerProps || []).length > 0).length,
          totalPlayerProps,
          historySnapshots,
          clvTimelineSamples,
          deletedExpiredProps: deletedExpired,
          propMarketTier,
          propMarkets: propMarketMeta,
          propMarketsCount: resolvePlayerPropMarketsForSport(sport, propMarketTier).length,
          tuning: coverageGuidancePayload(sport, planMode, eventPropLimit, windowDays, liveCacheTtlSec, source),
          quotaPlanning: buildQuotaPlanningReport({
            sports: [sport],
            planMode,
            cacheTtlSeconds: liveCacheTtlSec,
            booksConfigured: configuredBookmakers().length || 6,
          }),
        },
        budget,
        reliability: {
          reliabilityAvg: responseProps.length
            ? Math.round(
                responseProps.reduce((sum, p) => sum + Number(p?.analytics?.reliabilityScore || 0), 0) / responseProps.length
              )
            : 0,
          sourceConfidenceDecayAvg: responseProps.length
            ? Number(
                (
                  responseProps.reduce(
                    (sum, p) => sum + Number(p?.analytics?.sourceConfidenceDecay || 0),
                    0
                  ) / responseProps.length
                ).toFixed(2)
              )
            : 0,
        },
        props: responseProps,
      }),
    };
  } catch (err) {
    console.error("❌ Failed to scrape props:", err.message);
    try {
      const cached = await readPropsCache(sport);
      if (cached?.props?.length) {
        return {
          statusCode: 200,
          body: JSON.stringify({
            sport,
            mode: "props",
            count: cached.props.length,
            totalPlayerProps: cached.props.reduce((sum, p) => sum + ((p.playerProps || []).length || 0), 0),
            source: "stale_cache",
            generatedAt: new Date().toISOString(),
            booksRequested: PREFERRED_BOOKMAKERS,
            warning: `Live providers failed; returned cached props. Reason: ${err.message}`,
            cachedAt: cached.cachedAt || null,
            budget: {},
            props: cached.props,
          }),
        };
      }
    } catch (cacheErr) {
      console.error("❌ Failed to read props cache:", cacheErr.message);
    }
    return {
      statusCode: 200,
      body: JSON.stringify({
        sport,
        mode: "props",
        count: 0,
        totalPlayerProps: 0,
        source: "degraded_empty",
        generatedAt: new Date().toISOString(),
        booksRequested: PREFERRED_BOOKMAKERS,
        warning: `All providers failed and no cache available: ${err.message}`,
        budget: {},
        props: [],
      }),
    };
  }
};