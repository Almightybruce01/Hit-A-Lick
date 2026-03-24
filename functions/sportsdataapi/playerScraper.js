import { onSchedule } from "firebase-functions/v2/scheduler";
import axios from "axios";
import cheerio from "cheerio";
import { db, admin } from "./firebaseConfig.js";

function cleanCell(value = "") {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function asIntOrNull(value) {
  const n = Number(String(value || "").replace(/[^\d]/g, ""));
  return Number.isFinite(n) && n > 0 ? n : null;
}

function headerToKey(header = "") {
  const h = String(header || "").toLowerCase();
  if (h.includes("pos")) return "position";
  if (h === "ht" || h.includes("height")) return "height";
  if (h === "wt" || h.includes("weight")) return "weight";
  if (h.includes("age")) return "age";
  if (h.includes("college") || h.includes("school")) return "school";
  if (h.includes("hometown") || h.includes("birthplace")) return "hometown";
  if (h.includes("exp")) return "experience";
  if (h.includes("number") || h === "#") return "jerseyNumber";
  return null;
}

export const handler = async (event) => {
  const sport = event?.queryStringParameters?.sport?.toLowerCase();

  if (!sport) {
    return {
      statusCode: 400,
      body: "Missing ?sport param",
    };
  }

  const baseUrls = {
    nba: "https://www.espn.com/nba/teams",
    nfl: "https://www.espn.com/nfl/teams",
    mlb: "https://www.espn.com/mlb/teams",
    wnba: "https://www.espn.com/wnba/teams",
  };

  const baseUrl = baseUrls[sport];
  if (!baseUrl) {
    return {
      statusCode: 400,
      body: "Invalid sport",
    };
  }

  console.log(`📡 Player scraper started for: ${sport.toUpperCase()}`);

  try {
    const { data } = await axios.get(baseUrl, {
      headers: { "User-Agent": "Mozilla/5.0" },
    });

    const $ = cheerio.load(data);
    const teamLinks = [];

    // Extract roster URLs and team IDs
    $("section.TeamLinks").each((_, section) => {
      const teamUrl = $(section)
        .find("ul li a")
        .filter((_, el) => $(el).text().toLowerCase().includes("roster"))
        .attr("href");

      if (!teamUrl) return;

      const abbr = teamUrl.split("/name/")[1]?.split("/")[0]?.toLowerCase();
      const fullUrl = teamUrl.startsWith("http")
        ? teamUrl
        : `https://www.espn.com${teamUrl}`;

      const teamId = abbr ? `${abbr}-${sport}` : null;

      if (teamId) {
        teamLinks.push({ url: fullUrl, teamId });
      }
    });

    console.log(`📋 Found ${teamLinks.length} roster pages to scrape.`);

    // Map abbrev (e.g. bos) → Firestore team doc id (e.g. boston-celtics_nba)
    const teamSnap = await db.collection("team").where("sportId", "==", sport).get();
    const abbrToTeamId = {};
    teamSnap.forEach((doc) => {
      const d = doc.data();
      const abbr = (d.abbreviation || "").toLowerCase();
      if (abbr) abbrToTeamId[abbr] = doc.id;
    });

    // Loop through each team and scrape its roster
    for (const { url, teamId: rosterTeamKey } of teamLinks) {
      const teamId = abbrToTeamId[rosterTeamKey?.split("-")[0]] || rosterTeamKey;
      console.log(`🌐 Scraping roster for team: ${teamId}`);

      try {
        const { data: html } = await axios.get(url, {
          headers: { "User-Agent": "Mozilla/5.0" },
        });

        const $$ = cheerio.load(html);
        const headers = [];
        $$("table thead tr th").each((_, th) => {
          headers.push(cleanCell($$(th).text()));
        });
        const rows = $$(".Table__TR.Table__even, .Table__TR.Table__odd");

        for (const row of rows) {
          const name = $$(row).find("a.AnchorLink").first().text().trim();
          const profileLink = $$(row).find("a.AnchorLink").first().attr("href");

          if (!profileLink) continue;

          const playerId = profileLink.split("/id/")[1]?.split("/")[0];
          const tds = $$(row).find("td");
          const cells = [];
          tds.each((_, td) => cells.push(cleanCell($$(td).text())));
          const mapped = {};
          for (let i = 0; i < cells.length; i += 1) {
            const key = headerToKey(headers[i] || "");
            if (key) mapped[key] = cells[i];
          }

          const position = mapped.position || cleanCell(tds.eq(2).text());
          const school = mapped.school || null;
          const hometown = mapped.hometown || null;
          const height = mapped.height || null;
          const weight = asIntOrNull(mapped.weight);
          const age = asIntOrNull(mapped.age);
          const experience = mapped.experience || null;
          const jerseyNumber = asIntOrNull(mapped.jerseyNumber);

          const headshot = `https://a.espncdn.com/i/headshots/${sport}/players/full/${playerId}.png`;

          if (playerId && name) {
            await db
              .collection("players")
              .doc(playerId)
              .set(
                {
                  playerId,
                  name,
                  position,
                  team: teamId,
                  headshot,
                  sport,
                  sportId: sport,
                  espnAthleteId: playerId,
                  profileUrl: profileLink.startsWith("http") ? profileLink : `https://www.espn.com${profileLink}`,
                  age,
                  height,
                  weight,
                  school,
                  hometown,
                  experience,
                  jerseyNumber,
                  updatedAt: new Date().toISOString(),
                },
                { merge: true }
              );

            console.log(`✅ Saved: ${name} (${playerId}) → ${teamId}`);
          }
        }
      } catch (err) {
        console.error(`❌ Error scraping ${teamId}: ${err.message}`);
      }
    }

    return {
      statusCode: 200,
      body: `✅ Player DB updated for ${sport.toUpperCase()}`,
    };
  } catch (err) {
    console.error("❌ Scraping error:", err.message);
    return {
      statusCode: 500,
      body: "Failed to scrape players",
    };
  }
};

/** Scheduled: heavy job — roster scrape per league (sequential to reduce ESPN load) */
export const scrapePlayers = onSchedule("every day 05:30", async () => {
  const sports = ["nba", "nfl", "mlb", "wnba"];
  for (const sport of sports) {
    const result = await handler({ queryStringParameters: { sport } });
    if (result.statusCode >= 400) {
      console.error(`scrapePlayers failed for ${sport}:`, result.body);
    }
  }
});