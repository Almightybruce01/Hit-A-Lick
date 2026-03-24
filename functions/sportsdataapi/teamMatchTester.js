import axios from "axios";
import cheerio from "cheerio";
import { db } from "./firebaseConfig.js";

export const handler = async (event) => {
  const params = event?.queryStringParameters || {};
  const sport = params.sport?.toLowerCase();

  if (!sport) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: "Missing ?sport param" }),
    };
  }

  const urlMap = {
    nba: "https://www.espn.com/nba/schedule",
    nfl: "https://www.espn.com/nfl/schedule",
    mlb: "https://www.espn.com/mlb/schedule",
    wnba: "https://www.espn.com/wnba/schedule",
  };

  const url = urlMap[sport];
  if (!url) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: "Invalid sport param" }),
    };
  }

  console.log(`🧪 Team Match Tester → SPORT: ${sport.toUpperCase()}`);
  console.log(`🌐 Fetching ESPN schedule: ${url}`);

  try {
    const res = await axios.get(url, {
      headers: { "User-Agent": "Mozilla/5.0" },
    });
    const $ = cheerio.load(res.data);

    // -------------------------------
    // LOAD TEAMS FROM FIRESTORE
    // -------------------------------
    const teamSnap = await db
      .collection("team")
      .where("sportId", "==", sport)
      .get();

    const teamMap = {};

    teamSnap.forEach((doc) => {
      const t = doc.data();
      const { name, city, abbreviation, teamId } = t;

      const keys = [
        name,
        city,
        abbreviation,
        name?.split(" ").slice(1).join(" "), // last name (Warriors)
      ].filter(Boolean);

      keys.forEach((key) => {
        const cleaned = key.toLowerCase().replace(/[^a-z]/g, "");
        if (cleaned) teamMap[cleaned] = teamId;
      });
    });

    console.log(
      `📥 Loaded ${Object.keys(teamMap).length} searchable team keys from Firestore`
    );

    // -------------------------------
    // PARSE ESPN MATCHUPS
    // -------------------------------
    const failedMatches = [];

    $("table tbody tr").each((_, row) => {
      const text = $(row).find("td").first().text().trim();
      if (!text) return;

      let teamA = "";
      let teamB = "";

      if (text.includes("@")) {
        // NBA, WNBA, MLB format: "Lakers @ Warriors"
        [teamA, teamB] = text.split("@");
      } else if (/vs/i.test(text)) {
        // NFL or variation: "Cowboys vs Eagles"
        [teamB, teamA] = text.split(/vs/i);
      } else {
        failedMatches.push({
          matchup: text,
          reason: "No @ or 'vs' delimiter found",
        });
        return;
      }

      const normalize = (s) => s.toLowerCase().replace(/[^a-z]/g, "");

      const findTeam = (str) => {
        const cleaned = normalize(str);
        return Object.entries(teamMap).find(([key]) => {
          return key.includes(cleaned) || cleaned.includes(key);
        });
      };

      const teamAResult = findTeam(teamA);
      const teamBResult = findTeam(teamB);

      if (!teamAResult || !teamBResult) {
        failedMatches.push({
          matchup: text,
          teamA: teamA.trim(),
          teamB: teamB.trim(),
          teamAFound: !!teamAResult,
          teamBFound: !!teamBResult,
        });
      }
    });

    console.log(`🧪 Match Test Completed → ${failedMatches.length} failed matches`);

    return {
      statusCode: 200,
      body: JSON.stringify({
        totalFailed: failedMatches.length,
        failedMatches,
      }),
    };
  } catch (err) {
    console.error("❌ Error in teamMatchTester:", err.message);

    return {
      statusCode: 500,
      body: JSON.stringify({
        error: "Failed to test matchup structure",
        details: err.message,
      }),
    };
  }
};