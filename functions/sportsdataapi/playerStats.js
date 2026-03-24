import { db, admin } from "./firebaseConfig.js";
import { buildStatSummary, toCompactGame } from "./analytics.js";
import { seasonKeyForSport, keepSeasonKeys } from "./season.js";
const SPORT_IDS = ["nba", "nfl", "mlb", "wnba"];

function inferSportFromText(text = "") {
  const t = String(text).toLowerCase();
  if (t.includes("wnba")) return "wnba";
  if (t.includes("nfl")) return "nfl";
  if (t.includes("mlb")) return "mlb";
  if (t.includes("nba")) return "nba";
  return null;
}

function playerStatsCacheDoc(sport) {
  return db.collection("_apiCache").doc(`playerStats_${sport}`);
}

async function readPlayerStatsCache(sport) {
  const snap = await playerStatsCacheDoc(sport).get();
  if (!snap.exists) return null;
  const data = snap.data() || {};
  return {
    rows: Array.isArray(data.rows) ? data.rows : [],
    cachedAt: data.cachedAt || null,
  };
}

async function writePlayerStatsCache(sport, rows) {
  await playerStatsCacheDoc(sport).set(
    {
      sport,
      rows,
      cachedAt: admin.firestore.FieldValue.serverTimestamp(),
    },
    { merge: true }
  );
}

export const handler = async (event) => {
  const query = event?.queryStringParameters || {};
  const sport = query.sport?.toLowerCase() || "nba";
  const includeSummary = String(query.includeSummary || "1") !== "0";
  const maxPlayers = Math.min(Math.max(Number(query.limit || 800), 1), 2500);
  const historyLimit = Math.min(Math.max(Number(query.historyLimit || 220), 20), 500);
  const seasonMode = String(query.season || "current").toLowerCase(); // current | previous | all

  console.log(`📊 Fetching player stats for: ${sport.toUpperCase()}`);

  try {
    // Load all players for this sport
    const playersRef = db.collection("players");
    let playerDocs = [];
    if (sport === "all") {
      const perSport = Math.max(1, Math.floor(maxPlayers / SPORT_IDS.length));
      const settled = await Promise.allSettled(
        SPORT_IDS.map((s) => playersRef.where("sportId", "==", s).limit(perSport).get())
      );
      for (const result of settled) {
        if (result.status === "fulfilled") playerDocs.push(...result.value.docs);
      }
    } else {
      const playerSnap = await playersRef.where("sportId", "==", sport).limit(maxPlayers).get();
      playerDocs = playerSnap.docs;
    }

    const results = await Promise.all(
      playerDocs.map(async (doc) => {
        const data = doc.data();
        const playerId = doc.id;

        const statHistorySnap = await db
          .collection(`players/${playerId}/stats`)
          .orderBy("date", "desc")
          .limit(historyLimit)
          .get();

        const statHistory = statHistorySnap.docs.map((statDoc) => statDoc.data());
        const compactHistory = statHistory.map(toCompactGame).map((g) => ({
          ...g,
          seasonKey: seasonKeyForSport(g.date || new Date().toISOString(), data.sportId || sport || "nba"),
        }));
        const keepKeys = keepSeasonKeys(data.sportId || sport || "nba");
        const filteredHistory = seasonMode === "all"
          ? compactHistory
          : seasonMode === "previous"
            ? compactHistory.filter((g) => g.seasonKey === keepKeys[1])
            : compactHistory.filter((g) => g.seasonKey === keepKeys[0]);

        const item = {
          playerId,
          sport:
            data.sportId ||
            inferSportFromText(`${data.team || ""} ${data.teamName || ""} ${data.league || ""}`) ||
            (sport === "all" ? "nba" : sport),
          name: data.name,
          team: data.team || data.teamName || "",
          headshot: data.headshot || data.image || null,
          espnAthleteId: data.espnAthleteId || data.espnId || data.espnPlayerId || null,
          position: data.position || null,
          statHistory: filteredHistory,
          injuryStatus: data.injuryStatus || null,
          teamId: data.teamId || null,
          updatedAt: data.updatedAt || null,
        };
        if (includeSummary) {
          item.summary = buildStatSummary(filteredHistory);
        }
        return item;
      })
    );

    console.log(`✅ Retrieved ${results.length} player stat packages`);
    await writePlayerStatsCache(sport, results);

    return {
      statusCode: 200,
      body: JSON.stringify({
        sport,
        mode: "player",
        seasonMode,
        count: results.length,
        generatedAt: new Date().toISOString(),
        rows: results,
      }),
    };
  } catch (err) {
    console.error("❌ Error fetching player stats:", err);
    try {
      const cached = await readPlayerStatsCache(sport);
      if (cached?.rows?.length) {
        return {
          statusCode: 200,
          body: JSON.stringify({
            sport,
            mode: "player",
            count: cached.rows.length,
            generatedAt: new Date().toISOString(),
            cache: "stale",
            rows: cached.rows,
          }),
          headers: {
            "x-hitalick-cache": "stale",
          },
        };
      }
    } catch (cacheErr) {
      console.error("❌ Error reading playerStats cache:", cacheErr);
    }
    return {
      statusCode: 200,
      body: JSON.stringify({
        sport,
        mode: "player",
        count: 0,
        generatedAt: new Date().toISOString(),
        cache: "empty-fallback",
        rows: [],
      }),
      headers: {
        "x-hitalick-cache": "empty-fallback",
      },
    };
  }
};