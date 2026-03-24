import { onSchedule } from "firebase-functions/v2/scheduler";
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

export const handler = async () => {
  const leagues = ["nba", "mlb", "nfl", "wnba"];
  const now = new Date();

  console.log("⏳ Starting scheduled cacheUpcomingGames job…");

  // 🧹 CLEAN OLD GAMES
  try {
    const expiredSnap = await db
      .collection("upcomingGames")
      .where("status", "==", "upcoming")
      .get();

    for (const doc of expiredSnap.docs) {
      const data = doc.data();
      const gameTime = new Date(data.scheduledTime);

      if (gameTime < now) {
        await doc.ref.delete();
        console.log(`🗑️ Removed expired game: ${doc.id}`);
      }
    }
  } catch (err) {
    console.error("❌ Failed pruning old games:", err.message);
  }

  // 🕸 SCRAPE EACH LEAGUE
  for (const sport of leagues) {
    const url = `https://www.espn.com/${sport}/schedule`;

    try {
      console.log(`🌐 Scraping ESPN schedule for ${sport.toUpperCase()}…`);

      const html = (
        await axios.get(url, {
          headers: { "User-Agent": "Mozilla/5.0" },
        })
      ).data;

      const $ = cheerio.load(html);

      // Load Firestore teams for slug matching
      const teamSnap = await db
        .collection("team")
        .where("sportId", "==", sport)
        .get();

      const slugMap = {};
      teamSnap.forEach((doc) => {
        const t = doc.data();
        const slug = t?.espnUrl?.split("/team/_/name/")[1]?.split("/")[1];
        if (slug) slugMap[normalize(slug)] = doc.id;
      });

      const usedTeams = new Set();
      const rows = [];

      $("table.schedule.has-team-logos").each((_, table) => {
        const rawDate = $(table).prevAll("h2").first().text().trim();
        $(table).find("tbody tr").each((_, row) => {
          const tds = $(row).find("td");
          if (tds.length < 2) return;
          const teamLinks = $(tds[0]).find("a");
          const awayHref = teamLinks.first().attr("href");
          const homeHref = teamLinks.last().attr("href");
          const timeStr = $(tds[1]).text().trim();
          rows.push({ rawDate, awayHref, homeHref, timeStr });
        });
      });

      for (const { rawDate, awayHref, homeHref, timeStr } of rows) {
        const awaySlug = awayHref?.split("/team/_/name/")[1]?.split("/")[1];
        const homeSlug = homeHref?.split("/team/_/name/")[1]?.split("/")[1];
        const awayTeam = slugMap[normalize(awaySlug)];
        const homeTeam = slugMap[normalize(homeSlug)];

        if (!awayTeam || !homeTeam) continue;
        if (usedTeams.has(awayTeam) || usedTeams.has(homeTeam)) continue;

        const parsedTime =
          timeStr.includes("AM") || timeStr.includes("PM")
            ? convertTo24Hour(timeStr)
            : timeStr;
        const fullDate = parseDateTime(rawDate, parsedTime);
        if (!fullDate || fullDate <= now) continue;

        const gameId = `${sport}_${awayTeam}_at_${homeTeam}_${rawDate.replace("/", "-")}`;

        await db.collection("upcomingGames").doc(gameId).set(
          {
            gameId,
            sportId: sport,
            awayTeam,
            homeTeam,
            scheduledTime: fullDate.toISOString(),
            status: "upcoming",
            lastUpdated: new Date().toISOString(),
            source: "espn",
          },
          { merge: true }
        );

        usedTeams.add(awayTeam);
        usedTeams.add(homeTeam);
        console.log(`✅ Saved upcoming game → ${gameId}`);
      }
    } catch (err) {
      console.error(
        `❌ Failed scraping ${sport.toUpperCase()} schedule:`,
        err.message
      );
    }
  }

  console.log("🏁 Finished cacheUpcomingGames job.");

  return {
    statusCode: 200,
    body: JSON.stringify({
      message: "✅ cacheUpcomingGames completed successfully",
    }),
  };
};

export const cacheUpcomingGames = onSchedule("every 6 hours", async () => {
  const result = await handler();
  if (result.statusCode >= 400) {
    console.error("cacheUpcomingGames schedule failed:", result.body);
  }
});