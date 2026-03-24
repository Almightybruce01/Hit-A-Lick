import { onSchedule } from "firebase-functions/v2/scheduler";
import axios from "axios";
import { db, admin } from "./firebaseConfig.js";

export const handler = async () => {
  const sports = ["nba", "mlb", "nfl", "wnba"];
  const modes = ["player", "team"];

  try {
    for (const sport of sports) {
      for (const mode of modes) {
        const route = mode === "player" ? "playerStats" : "teamStats";
        const url = `https://xmsi72yc6d.execute-api.us-east-2.amazonaws.com/${route}?sport=${sport}`;

        console.log(`📡 Fetching ${mode} stats for ${sport.toUpperCase()} from ${url}`);

        const res = await axios.get(url);

        let stats = Array.isArray(res.data)
          ? res.data
          : res.data?.stats || [];

        // 🔥 Keep only 20 most recent if “date” exists
        stats = stats
          .sort((a, b) => new Date(b?.date || 0) - new Date(a?.date || 0))
          .slice(0, 20);

        await db.collection("cacheStats").doc(`${sport}_${mode}`).set(
          {
            sport,
            mode,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            stats,
          },
          { merge: true }
        );

        console.log(
          `✅ Cached ${stats.length} ${mode} stats for ${sport.toUpperCase()}`
        );
      }
    }

    return {
      statusCode: 200,
      body: JSON.stringify({
        message: "✅ cacheStats completed successfully",
      }),
    };
  } catch (err) {
    console.error("❌ Failed to cache stats:", err);

    return {
      statusCode: 500,
      body: JSON.stringify({
        error: "Failed to cache stats",
        details: err.message,
      }),
    };
  }
};

export const cacheStats = onSchedule("every day 08:00", async () => {
  const result = await handler();
  if (result.statusCode >= 400) {
    console.error("cacheStats schedule failed:", result.body);
  }
});