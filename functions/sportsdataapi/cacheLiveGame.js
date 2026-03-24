import { onSchedule } from "firebase-functions/v2/scheduler";
import axios from "axios";
import cheerio from "cheerio";
import { db, admin } from "./firebaseConfig.js";

export const handler = async () => {
  const leagues = ["nba", "mlb", "nfl", "wnba"];

  console.log("⏳ Starting cacheLiveGame...");

  try {
    for (const sport of leagues) {
      console.log(`🔍 Checking liveGames for: ${sport.toUpperCase()}`);

      // Load all stored live games for this sport
      const liveGamesSnapshot = await db
        .collection("liveGames")
        .where("sportId", "==", sport)
        .get();

      for (const doc of liveGamesSnapshot.docs) {
        const game = doc.data();
        const gameId = doc.id;

        const espnUrl = game.espnUrl;
        if (!espnUrl) {
          console.warn(`⚠️ No ESPN URL for live game: ${gameId}`);
          continue;
        }

        try {
          console.log(`🌐 Fetching update for ${gameId} → ${espnUrl}`);

          const res = await axios.get(espnUrl, {
            headers: { "User-Agent": "Mozilla/5.0" },
          });

          const html = res.data;
          const $ = cheerio.load(html);

          // Parse only what you need  
          const status = $("span.game-status, div.game-status").first().text().trim();
          const clock = $("span.game-time, span.Clock").first().text().trim();

          const updated = {
            lastScraped: new Date().toISOString(),
            status: status || game.status || null,
            clock: clock || null,
            source: "espn",
          };

          await db.collection("liveGames").doc(gameId).set(updated, { merge: true });

          console.log(`✅ Updated live game ${gameId}`);
        } catch (err) {
          console.error(`❌ Error updating live game ${gameId}: ${err.message}`);
        }
      }
    }

    console.log("🏁 Finished cacheLiveGame.");

    return {
      statusCode: 200,
      body: JSON.stringify({
        message: "✅ cacheLiveGame completed successfully.",
      }),
    };
  } catch (err) {
    console.error("❌ Fatal error in cacheLiveGame:", err.message);

    return {
      statusCode: 500,
      body: JSON.stringify({
        error: "Failed cacheLiveGame",
        details: err.message,
      }),
    };
  }
};

/** Scheduled: refresh ESPN scrape for stored live games */
export const cacheLiveGame = onSchedule("every 30 minutes", async () => {
  const result = await handler();
  if (result.statusCode >= 400) {
    console.error("cacheLiveGame schedule failed:", result.body);
  }
});