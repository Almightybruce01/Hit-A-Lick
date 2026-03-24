import { onSchedule } from "firebase-functions/v2/scheduler";
import axios from "axios";
import cheerio from "cheerio";
import { db, admin } from "./firebaseConfig.js";

export const handler = async (event) => {
  const sport = event?.queryStringParameters?.sport?.toLowerCase();
  
  if (!sport) {
    return {
      statusCode: 400,
      body: "Missing sport query param",
    };
  }

  const leagueUrls = {
    nba: "https://www.espn.com/nba/teams",
    nfl: "https://www.espn.com/nfl/teams",
    mlb: "https://www.espn.com/mlb/teams",
    wnba: "https://www.espn.com/wnba/teams",
  };

  const url = leagueUrls[sport];
  if (!url) {
    return {
      statusCode: 400,
      body: "Invalid sport",
    };
  }

  console.log(`📡 Team scraper started for: ${sport.toUpperCase()}`);

  try {
    const { data } = await axios.get(url, {
      headers: { "User-Agent": "Mozilla/5.0" },
    });

    const $ = cheerio.load(data);
    const teams = [];

    // Extract team card blocks
    $("section.TeamLinks").each((_, section) => {
      const rawName = $(section).find("h2 a").text().trim();
      const href = $(section).find("h2 a").attr("href");

      if (!href || !rawName) return;

      // ESPN URL: /nba/team/_/name/bos/boston-celtics → abbrev=bos, slug=boston-celtics
      const pathParts = href.split("/team/_/name/")[1]?.split("/").filter(Boolean) || [];
      const abbreviation = pathParts[0]?.toLowerCase() || null;
      const slug = pathParts[1]?.toLowerCase() || href.split("/").pop()?.toLowerCase();
      const teamId = slug ? `${slug}_${sport}` : null;
      if (!teamId || !abbreviation) return;

      // Fix team names
      const city = rawName.split(" ").slice(0, -1).join(" ");
      const fullName = rawName;

      // ESPN URL
      const espnUrl = href.startsWith("http") ? href : `https://www.espn.com${href}`;

      // Logo scrape
      const logoImg = $(section).parent().find("img").first().attr("src") || "";
      const logoUrl =
        logoImg.startsWith("http") ? logoImg : logoImg ? `https:${logoImg}` : "";

      teams.push({
        teamId,
        abbreviation,
        city,
        name: fullName,
        sport: sport.toUpperCase(),
        sportId: sport,
        logoUrl,
        espnUrl,
      });
    });

    console.log(`📊 Parsed ${teams.length} teams from ESPN (${sport.toUpperCase()})`);

    // Save into Firestore
    for (const t of teams) {
      await db.collection("team").doc(t.teamId).set(t, { merge: true });
      console.log(`✅ Saved team: ${t.teamId} (${t.name})`);
    }

    return {
      statusCode: 200,
      body: `✅ Team DB updated for ${sport.toUpperCase()}`,
    };
  } catch (err) {
    console.error("❌ Error scraping teams:", err.message);

    return {
      statusCode: 500,
      body: JSON.stringify({
        error: "Failed to scrape teams",
        details: err.message,
      }),
    };
  }
};

/** Scheduled: refresh ESPN team index for all leagues */
export const scrapeTeams = onSchedule("every day 05:00", async () => {
  const sports = ["nba", "nfl", "mlb", "wnba"];
  for (const sport of sports) {
    const result = await handler({ queryStringParameters: { sport } });
    if (result.statusCode >= 400) {
      console.error(`scrapeTeams failed for ${sport}:`, result.body);
    }
  }
});