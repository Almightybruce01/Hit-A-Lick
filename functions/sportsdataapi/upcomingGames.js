import axios from "axios";
import cheerio from "cheerio";
import { db } from "./firebaseConfig.js";

const normalize = (str) =>
  str?.toLowerCase().replace(/[^a-z0-9]/g, "") || "";

function convertTo24Hour(timeStr) {
  if (!timeStr) return null;

  const [time, meridiem] = timeStr.split(" ");
  if (!time || !meridiem) return timeStr;

  let [hours, minutes] = time.split(":");
  if (meridiem === "PM" && hours !== "12") hours = `${+hours + 12}`;
  if (meridiem === "AM" && hours === "12") hours = "00";

  return `${hours.padStart(2, "0")}:${minutes}`;
}

function parseDateTime(dateStr, timeStr) {
  if (!dateStr || !timeStr) return null;

  const [month, day] = dateStr.split("/");
  const year = new Date().getFullYear();

  return new Date(
    `${year}-${month.padStart(2, "0")}-${day.padStart(
      2,
      "0"
    )}T${timeStr}:00Z`
  );
}

export const handler = async (event) => {
  const sport = event?.queryStringParameters?.sport?.toLowerCase();

  if (!sport) {
    return {
      statusCode: 400,
      body: JSON.stringify({
        error: "Missing ?sport param (nba, nfl, mlb, wnba)",
      }),
    };
  }

  const url = `https://www.espn.com/${sport}/schedule`;

  console.log(`📅 Scraping upcoming games for ${sport.toUpperCase()}`);

  try {
    const html = (
      await axios.get(url, {
        headers: { "User-Agent": "Mozilla/5.0" },
      })
    ).data;

    const $ = cheerio.load(html);
    const results = [];

    // Load team mapping from Firestore
    const teamSnap = await db
      .collection("team")
      .where("sportId", "==", sport)
      .get();

    const teams = {};
    teamSnap.forEach((doc) => {
      const data = doc.data();
      const slug = data?.espnUrl?.split("/team/_/name/")[1]?.split("/")[1];
      if (slug) teams[normalize(slug)] = doc.id;
    });

    $("table.schedule.has-team-logos").each((_, table) => {
      const dateHeader = $(table)
        .prevAll("h2")
        .first()
        .text()
        .trim();

      $(table)
        .find("tbody tr")
        .each((_, row) => {
          const tds = $(row).find("td");
          if (tds.length < 2) return;

          const teamLinks = $(tds[0]).find("a");
          const awayHref = teamLinks.first().attr("href");
          const homeHref = teamLinks.last().attr("href");
          const timeStr = $(tds[1]).text().trim();

          const awaySlug = awayHref
            ?.split("/team/_/name/")[1]
            ?.split("/")[1];
          const homeSlug = homeHref
            ?.split("/team/_/name/")[1]
            ?.split("/")[1];

          const awayTeam = teams[normalize(awaySlug)];
          const homeTeam = teams[normalize(homeSlug)];

          if (!awayTeam || !homeTeam) return;

          const parsedTime =
            timeStr.includes("AM") || timeStr.includes("PM")
              ? convertTo24Hour(timeStr)
              : timeStr;

          const fullDate = parseDateTime(dateHeader, parsedTime);
          if (!fullDate) return;

          const gameId = `${sport}_${awayTeam}_at_${homeTeam}_${dateHeader.replace(
            "/",
            "-"
          )}`;

          results.push({
            gameId,
            sportId: sport,
            awayTeam,
            homeTeam,
            scheduledTime: fullDate.toISOString(),
            espnDate: dateHeader,
            espnTime: timeStr,
            source: "espn",
          });
        });
    });

    console.log(`✅ Found ${results.length} upcoming ${sport.toUpperCase()} games`);

    // OPTIONAL: Save to Firestore (recommended)
    for (const g of results) {
      await db.collection("upcomingGames").doc(g.gameId).set(g, { merge: true });
    }

    return {
      statusCode: 200,
      body: JSON.stringify(results),
    };
  } catch (err) {
    console.error("❌ Error scraping:", err.message);
    return {
      statusCode: 500,
      body: JSON.stringify({
        error: "Failed to scrape upcoming games",
        details: err.message,
      }),
    };
  }
};