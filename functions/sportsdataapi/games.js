import { onSchedule } from "firebase-functions/v2/scheduler";
import axios from "axios";
import { db, admin } from "./firebaseConfig.js";
import { seasonKeyForSport, isHistoricalDate, ymd } from "./season.js";

const SCOREBOARD_ENDPOINTS = {
  nba: "https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard",
  nfl: "https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard",
  mlb: "https://site.api.espn.com/apis/site/v2/sports/baseball/mlb/scoreboard",
  wnba: "https://site.api.espn.com/apis/site/v2/sports/basketball/wnba/scoreboard",
};

const SPORT_ORDER = ["nba", "nfl", "mlb", "wnba"];

function gamesCacheDoc(sport) {
  return db.collection("_apiCache").doc(`games_${sport}`);
}

async function readGamesCache(sport) {
  const snap = await gamesCacheDoc(sport).get();
  if (!snap.exists) return null;
  const data = snap.data() || {};
  return {
    games: Array.isArray(data.games) ? data.games : [],
    source: data.source || "cache",
    cachedAt: data.cachedAt || null,
    cachedAtIso: data.cachedAtIso || null,
  };
}

async function writeGamesCache(sport, payload) {
  await gamesCacheDoc(sport).set(
    {
      sport,
      ...payload,
      cachedAt: admin.firestore.FieldValue.serverTimestamp(),
      cachedAtIso: new Date().toISOString(),
    },
    { merge: true }
  );
}

function cacheIsFresh(isoLike, ttlSeconds = 45) {
  const ttl = Math.max(10, Number(ttlSeconds) || 45);
  const ts = Date.parse(String(isoLike || ""));
  if (!Number.isFinite(ts)) return false;
  return Date.now() - ts <= ttl * 1000;
}

function filterGamesLifecycle(games = [], windowDays = 3) {
  const now = new Date();
  const pastCutoff = new Date(now.getTime() - 4 * 60 * 60 * 1000);
  const futureCutoff = new Date(now.getTime() + Math.max(1, Number(windowDays) || 3) * 24 * 60 * 60 * 1000);
  return games.filter((g) => {
    const when = g?.date ? new Date(`${g.date}T${g.time || "12:00"}:00Z`) : null;
    if (!when || Number.isNaN(when.getTime())) return true;
    const state = String(g?.state || "").toLowerCase();
    if (state === "post" || state === "final" || String(g?.status || "").toLowerCase().includes("final")) {
      return when >= pastCutoff;
    }
    return when >= pastCutoff && when <= futureCutoff;
  });
}

function competitorBySide(comp, side) {
  return (comp.competitors || []).find((c) => c.homeAway === side) || {};
}

function extractBaseState(comp) {
  const situation = comp?.situation || {};
  const baseText = Array.isArray(situation?.onFirst) || Array.isArray(situation?.onSecond) || Array.isArray(situation?.onThird)
    ? [
        situation?.onFirst?.length ? "1B" : null,
        situation?.onSecond?.length ? "2B" : null,
        situation?.onThird?.length ? "3B" : null,
      ].filter(Boolean).join(" • ")
    : "";
  const count = [
    Number.isFinite(Number(situation?.balls)) ? `B${situation.balls}` : null,
    Number.isFinite(Number(situation?.strikes)) ? `S${situation.strikes}` : null,
    Number.isFinite(Number(situation?.outs)) ? `O${situation.outs}` : null,
  ].filter(Boolean).join(" ");
  if (!baseText && !count) return null;
  return [baseText || "Bases Empty", count].filter(Boolean).join(" | ");
}

function extractPossession(comp) {
  const possession = comp?.situation?.possession || comp?.situation?.lastPlay?.team?.displayName || null;
  return possession || null;
}

function liveHudFromCompetition(comp, sport) {
  const statusType = comp?.status?.type || {};
  const displayClock = comp?.status?.displayClock || "";
  const period = comp?.status?.period;
  const home = competitorBySide(comp, "home");
  const away = competitorBySide(comp, "away");
  const scoreline = `${away?.team?.abbreviation || "AWY"} ${away?.score || "0"} - ${home?.team?.abbreviation || "HME"} ${home?.score || "0"}`;

  return {
    gameId: comp?.id || null,
    status: statusType?.shortDetail || comp?.status?.type?.description || "Scheduled",
    state: statusType?.state || "pre",
    period: Number.isFinite(Number(period)) ? Number(period) : null,
    clock: displayClock || null,
    scoreline,
    possession: extractPossession(comp),
    baseState: sport === "mlb" ? extractBaseState(comp) : null,
    redZone: comp?.situation?.isRedZone ? true : false,
  };
}

function formatGame(event, sport) {
  const comp = event?.competitions?.[0] || {};
  const homeComp = competitorBySide(comp, "home");
  const awayComp = competitorBySide(comp, "away");
  const home = homeComp?.team?.displayName || "Home";
  const away = awayComp?.team?.displayName || "Away";
  const oddsObj = comp.odds?.[0] || {};
  const odds = oddsObj.details || "N/A";
  const venue = comp.venue?.fullName || event?.shortName || "TBD";
  const dt = event?.date ? new Date(event.date) : null;
  const date = dt ? dt.toISOString().split("T")[0] : new Date().toISOString().split("T")[0];
  const time = dt
    ? dt.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false })
    : "00:00";

  return {
    date,
    time,
    homeTeam: home,
    awayTeam: away,
    odds,
    venue,
    sport,
    ...liveHudFromCompetition(comp, sport),
  };
}

function gameHistoryCollection() {
  return db.collection("gameHistory");
}

async function readGameHistoryByDay(sport, dayKey) {
  let query = gameHistoryCollection().where("dayKey", "==", dayKey).limit(900);
  if (sport !== "all") query = query.where("sport", "==", sport);
  const snap = await query.get();
  return snap.docs.map((doc) => doc.data() || {});
}

async function writeGameHistorySnapshots(games = []) {
  if (!Array.isArray(games) || !games.length) return 0;
  const batchSize = 300;
  let writes = 0;
  for (let i = 0; i < games.length; i += batchSize) {
    const batch = db.batch();
    for (const game of games.slice(i, i + batchSize)) {
      const sport = String(game.sport || "nba").toLowerCase();
      const dayKey = String(game.date || ymd(new Date()));
      const seasonKey = seasonKeyForSport(dayKey, sport);
      const safeMatchup = `${game.awayTeam || "Away"}_at_${game.homeTeam || "Home"}`
        .replace(/[^a-zA-Z0-9_-]+/g, "_")
        .slice(0, 140);
      const docId = `${sport}_${dayKey}_${safeMatchup}`;
      batch.set(
        gameHistoryCollection().doc(docId),
        {
          ...game,
          sport,
          dayKey,
          seasonKey,
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

async function fetchGamesForSport(sport) {
  const endpoint = SCOREBOARD_ENDPOINTS[sport];
  if (!endpoint) return [];
  const { data } = await axios.get(endpoint, { timeout: 12000 });
  const events = Array.isArray(data?.events) ? data.events : [];
  return events.map((event) => formatGame(event, sport));
}

/** Pre-warm games cache and seed liveGames for in-progress games (for cacheLiveGame refresh). */
export async function prewarmGamesCache() {
  const windowDays = 3;
  for (const sport of SPORT_ORDER) {
    try {
      const games = await fetchGamesForSport(sport);
      const windowed = filterGamesLifecycle(games, windowDays);
      if (windowed.length) {
        await writeGamesCache(sport, { games: windowed, source: "espn_live" });
        await writeGameHistorySnapshots(windowed);
        for (const g of windowed) {
          if (g.state === "in" && g.gameId) {
            const espnUrl = `https://www.espn.com/${sport}/boxscore/_/gameId/${g.gameId}`;
            await db.collection("liveGames").doc(g.gameId).set(
              {
                gameId: g.gameId,
                sport,
                sportId: sport,
                espnUrl,
                status: g.status || null,
                source: "espn",
                lastUpdated: new Date().toISOString(),
              },
              { merge: true }
            );
          }
        }
      }
    } catch (err) {
      console.error(`prewarmGamesCache failed for ${sport}:`, err.message);
    }
  }
}

/** Scheduled: pre-warm games cache every 30 min so /games is fast + seed liveGames for cacheLiveGame. */
export const prewarmGames = onSchedule("every 30 minutes", async () => {
  try {
    await prewarmGamesCache();
  } catch (err) {
    console.error("prewarmGames failed:", err.message);
  }
});

export const handler = async (event) => {
  const sportRaw = event?.queryStringParameters?.sport?.toLowerCase() || "nba";
  const sport = sportRaw === "all" ? "all" : sportRaw;
  const requestedDayKey = event?.queryStringParameters?.date ? ymd(event.queryStringParameters.date) : null;
  const forceLive = String(event?.queryStringParameters?.forceLive || "0") === "1";
  const windowDays = Math.max(1, Number(event?.queryStringParameters?.windowDays || 3) || 3);
  const liveCacheTtlSec = Math.max(10, Number(process.env.GAMES_LIVE_CACHE_TTL_SECONDS || 45) || 45);

  try {
    if (!requestedDayKey && sport !== "all" && !forceLive) {
      const cached = await readGamesCache(sport);
      if (cached?.games?.length && cacheIsFresh(cached.cachedAtIso, liveCacheTtlSec)) {
        const filtered = filterGamesLifecycle(cached.games, windowDays);
        return {
          statusCode: 200,
          body: JSON.stringify({
            sport,
            count: filtered.length,
            failedSports: [],
            source: "live_cache",
            generatedAt: new Date().toISOString(),
            cachedAt: cached.cachedAt || null,
            cachedAtIso: cached.cachedAtIso || null,
            games: filtered,
          }),
        };
      }
    }

    if (requestedDayKey && isHistoricalDate(requestedDayKey)) {
      const historical = await readGameHistoryByDay(sport, requestedDayKey);
      return {
        statusCode: 200,
        body: JSON.stringify({
          sport,
          count: historical.length,
          failedSports: [],
          source: "history_cache",
          generatedAt: new Date().toISOString(),
          games: historical,
        }),
      };
    }

    const targets = sport === "all" ? SPORT_ORDER : [sport];
    if (!targets.every((s) => SCOREBOARD_ENDPOINTS[s])) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: "Invalid sport parameter." }),
      };
    }

    const settled = await Promise.allSettled(targets.map((s) => fetchGamesForSport(s)));
    const games = [];
    const failed = [];
    settled.forEach((result, idx) => {
      const s = targets[idx];
      if (result.status === "fulfilled") {
        games.push(...result.value);
      } else {
        failed.push(s);
      }
    });

    games.sort((a, b) => {
      const aDate = `${a.date} ${a.time}`;
      const bDate = `${b.date} ${b.time}`;
      return aDate.localeCompare(bDate);
    });
    const windowedGames = filterGamesLifecycle(games, windowDays);

    const historySnapshots = await writeGameHistorySnapshots(windowedGames);
    if (sport !== "all" && windowedGames.length) {
      await writeGamesCache(sport, { games: windowedGames, source: "espn_live" });
    }

    return {
      statusCode: 200,
      body: JSON.stringify({
        sport,
        count: windowedGames.length,
        failedSports: failed,
        source: "espn_live",
        historySnapshots,
        generatedAt: new Date().toISOString(),
        games: windowedGames,
      }),
    };
  } catch (err) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: `Failed to fetch games: ${err.message}` }),
    };
  }
};
