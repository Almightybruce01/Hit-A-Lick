import axios from "axios";

export const handler = async () => {
  const baseUrl = "https://xmsi72yc6d.execute-api.us-east-2.amazonaws.com";

  // Ordered in correct dependency order
  const endpoints = [
    "/sportSetup",
    "/scrapeTeams?sport=nba",
    "/scrapeTeams?sport=mlb",
    "/scrapeTeams?sport=nfl",
    "/scrapeTeams?sport=wnba",

    "/scrapePlayers?sport=nba",
    "/scrapePlayers?sport=mlb",
    "/scrapePlayers?sport=nfl",
    "/scrapePlayers?sport=wnba",

    "/cacheStats",
    "/cacheLiveGame",
    "/cacheUpcomingGames",

    "/upcomingGames?sport=nba",
    "/upcomingGames?sport=mlb",
    "/upcomingGames?sport=nfl",
    "/upcomingGames?sport=wnba",
  ];

  const results = [];

  const callEndpoint = async (path) => {
    const url = `${baseUrl}${path}`;

    try {
      const res = await axios.get(url, {
        timeout: 20000, // 20s timeout per endpoint
        headers: { "User-Agent": "Mozilla/5.0" },
      });

      console.log(`✅ SUCCESS → ${path}`);

      return {
        path,
        status: "success",
        timestamp: new Date().toISOString(),
        data: res.data || null,
      };
    } catch (err) {
      console.error(`❌ ERROR → ${path}:`, err.message);

      return {
        path,
        status: "error",
        timestamp: new Date().toISOString(),
        message: err.message,
      };
    }
  };

  // Sequential (safer for ESPN + Firestore rate limits)
  for (const path of endpoints) {
    const result = await callEndpoint(path);
    results.push(result);
  }

  const successCount = results.filter((r) => r.status === "success").length;
  const errorCount = results.filter((r) => r.status === "error").length;

  return {
    statusCode: 200,
    body: JSON.stringify({
      message: "CallAll completed",
      successCount,
      errorCount,
      results,
    }),
  };
};