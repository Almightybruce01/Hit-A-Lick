import axios from "axios";
import cheerio from "cheerio";
import { db, admin } from "./firebaseConfig.js";

export const handler = async (event) => {
  console.log("📡 /liveGame Lambda hit");

  const params = event?.queryStringParameters || {};
  const gameId = params.gameId;
  const sport = params.sport || "nba";

  if (!gameId) {
    console.warn("⚠️ Missing gameId query param");
    return {
      statusCode: 400,
      body: JSON.stringify({ error: "Missing gameId" }),
    };
  }

    const espnUrl = `https://www.espn.com/${sport}/boxscore/_/gameId/${gameId}`;
    console.log(`🌐 Scraping live game: ${espnUrl}`);

    try {
      const { data } = await axios.get(espnUrl, {
      headers: { "User-Agent": "Mozilla/5.0" },
    });

    const $ = cheerio.load(data);

    // Team names
    const teamNames = [];
    $("div.TeamLinks__TeamName").each((_, el) => {
      teamNames.push($(el).text().trim());
    });

    // Game info
    const location = $("span.game-location").text().trim();
    const time = $("span.game-time").first().text().trim();
    const status = $("span.game-status").text().trim();

    // Players on court (may be empty if ESPN hides info)
    const playersOnCourt = [];
    $("section:contains('Game Information')").each((_, section) => {
      const players = $(section)
        .find("ul li")
        .map((_, li) => $(li).text().trim())
        .get();

      if (players.length > 0) {
        playersOnCourt.push(players);
      }
    });

    const result = {
      gameId,
      sport,
      sportId: sport,
      teamNames,
      time,
      status,
      location,
      playersOnCourt,
      espnUrl,
      source: "espn",
      lastUpdated: new Date().toISOString(),
    };

    console.log("✅ Scraped live game data:", result);

    // Save to Firestore (espnUrl needed for cacheLiveGame scheduled refresh)
    await db.collection("liveGames").doc(gameId).set(result, { merge: true });
    console.log(`📦 Saved Firestore doc: liveGames/${gameId}`);

    return {
      statusCode: 200,
      body: JSON.stringify(result),
    };
  } catch (err) {
    console.error("❌ Failed to scrape live game:", err.message);

    return {
      statusCode: 500,
      body: JSON.stringify({ error: "Failed to fetch live game data" }),
    };
  }
};