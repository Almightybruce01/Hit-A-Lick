import { db, admin } from "./firebaseConfig.js";
import { buildStatSummary, toCompactGame } from "./analytics.js";
import { seasonKeyForSport, keepSeasonKeys } from "./season.js";

function teamStatsCacheDoc(sport) {
  return db.collection("_apiCache").doc(`teamStats_${sport}`);
}

async function readTeamStatsCache(sport) {
  const snap = await teamStatsCacheDoc(sport).get();
  if (!snap.exists) return null;
  const data = snap.data() || {};
  return {
    rows: Array.isArray(data.rows) ? data.rows : [],
    cachedAt: data.cachedAt || null,
  };
}

async function writeTeamStatsCache(sport, rows) {
  await teamStatsCacheDoc(sport).set(
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
  const historyLimit = Math.min(Math.max(Number(query.historyLimit || 220), 20), 500);
  const seasonMode = String(query.season || "current").toLowerCase(); // current | previous | all

  console.log(`📊 Fetching team stats for: ${sport.toUpperCase()}`);

  try {
    // Load teams for selected sport
    const teamSnap = await db
      .collection("team")
      .where("sportId", "==", sport)
      .get();

    const results = await Promise.all(
      teamSnap.docs.map(async (doc) => {
        const data = doc.data();
        const teamId = doc.id;

        const statHistorySnap = await db
          .collection(`team/${teamId}/stats`)
          .orderBy("date", "desc")
          .limit(historyLimit)
          .get();

        const statHistory = statHistorySnap.docs.map((statDoc) => statDoc.data()).map(toCompactGame).map((g) => ({
          ...g,
          seasonKey: seasonKeyForSport(g.date || new Date().toISOString(), sport),
        }));
        const keepKeys = keepSeasonKeys(sport);
        const filteredHistory = seasonMode === "all"
          ? statHistory
          : seasonMode === "previous"
            ? statHistory.filter((g) => g.seasonKey === keepKeys[1])
            : statHistory.filter((g) => g.seasonKey === keepKeys[0]);

        const item = {
          teamId,
          name: data.name,
          logoUrl: data.logoUrl || null,
          abbreviation: data.abbreviation || null,
          statHistory: filteredHistory,
        };
        if (includeSummary) {
          item.summary = buildStatSummary(filteredHistory);
        }
        return item;
      })
    );

    console.log(`✅ Retrieved ${results.length} team stat packages`);
    await writeTeamStatsCache(sport, results);

    return {
      statusCode: 200,
      body: JSON.stringify({
        sport,
        mode: "team",
        seasonMode,
        count: results.length,
        generatedAt: new Date().toISOString(),
        rows: results,
      }),
    };
  } catch (err) {
    console.error("❌ Error fetching team stats:", err);
    try {
      const cached = await readTeamStatsCache(sport);
      if (cached?.rows?.length) {
        return {
          statusCode: 200,
          body: JSON.stringify({
            sport,
            mode: "team",
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
      console.error("❌ Error reading teamStats cache:", cacheErr);
    }
    return {
      statusCode: 200,
      body: JSON.stringify({
        sport,
        mode: "team",
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