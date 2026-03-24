import { onSchedule } from "firebase-functions/v2/scheduler";
import { db, admin } from "./firebaseConfig.js";

export const handler = async () => {
  const sports = [
    { name: "NBA", sportId: "nba" },
    { name: "WNBA", sportId: "wnba" },
    { name: "NFL", sportId: "nfl" },
    { name: "MLB", sportId: "mlb" },
  ];

  console.log("📦 Populating /sport collection...");

  try {
    const batch = db.batch();

    for (const sport of sports) {
      const ref = db.collection("sport").doc(sport.sportId);
      batch.set(ref, sport);
    }

    await batch.commit();

    console.log("✅ Sports collection populated");

    return {
      statusCode: 200,
      body: "✅ Sports collection populated",
    };
  } catch (err) {
    console.error("❌ Error writing sports:", err.message);

    return {
      statusCode: 500,
      body: JSON.stringify({
        error: "Error populating sports",
        details: err.message,
      }),
    };
  }
};

export const setupSports = onSchedule("every monday 06:00", async () => {
  const result = await handler();
  if (result.statusCode >= 400) {
    console.error("setupSports schedule failed:", result.body);
  }
});