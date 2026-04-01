import { db } from "./firebaseConfig.js";
const SPORT_IDS = ["nba", "nfl", "mlb", "wnba"];

function inferSportFromText(text = "") {
  const t = String(text).toLowerCase();
  if (t.includes("wnba")) return "wnba";
  if (t.includes("nfl")) return "nfl";
  if (t.includes("mlb")) return "mlb";
  if (t.includes("nba")) return "nba";
  return null;
}

export const handler = async (event) => {
  const sport = event?.queryStringParameters?.sport?.toLowerCase() || "";
  const max = Math.min(
    Math.max(Number(event?.queryStringParameters?.limit || 1500), 1),
    5000
  );

  if (!sport) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: "Invalid or missing sport parameter" })
    };
  }

  try {
    const base = db.collection("players");
    const docs = [];
    if (sport === "all") {
      const perSport = Math.max(1, Math.floor(max / SPORT_IDS.length));
      const settled = await Promise.allSettled(
        SPORT_IDS.map((s) => base.where("sportId", "==", s).limit(perSport).get())
      );
      for (const result of settled) {
        if (result.status === "fulfilled") docs.push(...result.value.docs);
      }
    } else {
      const snap = await base.where("sportId", "==", sport).limit(max).get();
      docs.push(...snap.docs);
    }

    const players = docs.map((doc) => {
      const data = doc.data() || {};
      const inferred = inferSportFromText(`${data.team || ""} ${data.teamName || ""} ${data.league || ""}`);
      const name = data.name || "Player";
      const rawImg = String(data.headshot || data.image || "").trim();
      const hasHttp = /^https?:\/\//i.test(rawImg);
      const espnId = data.espnAthleteId || data.espnId || data.espnPlayerId || null;
      const sid = data.sportId || inferred || (sport === "all" ? "nba" : sport);
      const league = { nba: "nba", wnba: "wnba", nfl: "nfl", mlb: "mlb" }[String(sid).toLowerCase()] || "nba";
      const espnShot =
        espnId && /^\d+$/.test(String(espnId))
          ? `https://a.espncdn.com/i/headshots/${league}/players/full/${String(espnId)}.png`
          : null;
      const headshot = hasHttp ? rawImg : espnShot;
      return {
        playerId: doc.id,
        sport: sid,
        name,
        team: data.team || data.teamName || "",
        position: data.position || "",
        age: Number.isFinite(Number(data.age)) ? Number(data.age) : null,
        height: data.height || null,
        weight: Number.isFinite(Number(data.weight)) ? Number(data.weight) : null,
        school: data.school || null,
        hometown: data.hometown || null,
        experience: data.experience || null,
        jerseyNumber: Number.isFinite(Number(data.jerseyNumber)) ? Number(data.jerseyNumber) : null,
        headshot,
        headshotIsPlaceholder: !headshot,
        /** If set in Firestore, web client can load ESPN CDN headshots. */
        espnAthleteId: espnId,
        tankPlayerId: data.tankPlayerId || data.tank01Id || null,
      };
    });

    return {
      statusCode: 200,
      body: JSON.stringify(players),
    };
  } catch (error) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: error.message || "Failed to fetch players." }),
    };
  }
};