/**
 * Cross-provider entity resolution: Odds API team labels vs Firestore `team` / ESPN naming.
 * Adds `entityResolution` + optional `homeTeam`/`awayTeam` on props when missing.
 */
import { db } from "./firebaseConfig.js";

const TEAM_CACHE = new Map();
const CACHE_TTL_MS = 10 * 60 * 1000;

function normalizeTokens(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 1 || t === "a");
}

function jaccard(a, b) {
  const A = new Set(normalizeTokens(a));
  const B = new Set(normalizeTokens(b));
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const x of A) if (B.has(x)) inter += 1;
  return inter / (A.size + B.size - inter);
}

/** Strip city prefix when nickname matches (e.g. "Los Angeles Lakers" vs "Lakers"). */
function containmentBonus(a, b) {
  const al = String(a || "").toLowerCase();
  const bl = String(b || "").toLowerCase();
  if (al.length < 3 || bl.length < 3) return 0;
  if (al.includes(bl) || bl.includes(al)) return 0.25;
  return 0;
}

function scoreMatch(oddsLabel, candidateName) {
  const j = jaccard(oddsLabel, candidateName);
  const c = containmentBonus(oddsLabel, candidateName);
  return Math.min(1, j + c);
}

function bestTeamMatch(oddsLabel, candidates) {
  let best = null;
  let bestScore = 0;
  for (const row of candidates) {
    const name = row.name || "";
    const sc = scoreMatch(oddsLabel, name);
    if (sc > bestScore) {
      bestScore = sc;
      best = { teamId: row.teamId, name, score: sc };
    }
  }
  if (!best || bestScore < 0.28) return null;
  return { ...best, score: Number(bestScore.toFixed(3)) };
}

export function parseMatchupTeams(matchup) {
  const m = String(matchup || "").split("@").map((x) => x.trim());
  if (m.length >= 2) {
    return { away: m[0] || "", home: m[1] || "" };
  }
  return { away: "", home: "" };
}

async function loadTeamCandidates(sport) {
  const key = String(sport || "").toLowerCase();
  const hit = TEAM_CACHE.get(key);
  if (hit && Date.now() - hit.t < CACHE_TTL_MS) return hit.rows;

  const snap = await db.collection("team").where("sportId", "==", key).limit(250).get();
  const rows = snap.docs.map((doc) => {
    const d = doc.data() || {};
    return {
      teamId: doc.id,
      name: String(d.name || d.displayName || "").trim(),
      abbrev: String(d.abbrev || d.abbr || "").trim(),
    };
  }).filter((r) => r.name);

  TEAM_CACHE.set(key, { t: Date.now(), rows });
  return rows;
}

/**
 * Attach canonical team ids + confidence when Odds API names differ from your DB.
 */
export async function enrichPropsWithEntityResolution(props = [], sport) {
  if (!Array.isArray(props) || !props.length) return props;
  let candidates;
  try {
    candidates = await loadTeamCandidates(sport);
  } catch {
    return props;
  }
  if (!candidates.length) return props;

  return props.map((p) => {
    let home = p.homeTeam || "";
    let away = p.awayTeam || "";
    if (!home || !away) {
      const parsed = parseMatchupTeams(p.matchup);
      home = home || parsed.home;
      away = away || parsed.away;
    }
    const mh = home ? bestTeamMatch(home, candidates) : null;
    const ma = away ? bestTeamMatch(away, candidates) : null;
    const scores = [mh?.score, ma?.score].filter((x) => x != null);
    const avg = scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : null;

    return {
      ...p,
      homeTeam: home || p.homeTeam,
      awayTeam: away || p.awayTeam,
      entityResolution: {
        sport,
        homeOddsLabel: home || null,
        awayOddsLabel: away || null,
        homeCanon: mh ? { teamId: mh.teamId, name: mh.name, score: mh.score } : null,
        awayCanon: ma ? { teamId: ma.teamId, name: ma.name, score: ma.score } : null,
        matchConfidence: avg != null ? Number(avg.toFixed(3)) : null,
        method: "firestore_team_fuzzy",
      },
    };
  });
}
