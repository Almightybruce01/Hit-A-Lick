import { db } from "./firebaseConfig.js";

export const handler = async (event) => {
  const sport = event?.queryStringParameters?.sport?.toLowerCase() || "";

  if (!sport) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: "Invalid or missing sport parameter" })
    };
  }

  try {
    const snap = await db
      .collection("team")
      .where("sportId", "==", sport)
      .limit(200)
      .get();

    const items = snap.docs.map((doc) => {
      const data = doc.data() || {};
      return {
        teamId: doc.id,
        name: data.name || "",
        logoUrl: data.logoUrl || data.logo || null,
      };
    });

    const names = items.map((t) => t.name).filter(Boolean);

    return {
      statusCode: 200,
      body: JSON.stringify({ teams: names, items }),
    };
  } catch (error) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: error.message || "Failed to fetch teams." }),
    };
  }
};