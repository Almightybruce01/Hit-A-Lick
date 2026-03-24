import axios from "axios";
import cheerio from "cheerio";

export const handler = async (event) => {
  const params = event?.queryStringParameters || {};
  const sport = params.sport?.toLowerCase();

  if (!sport) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: "Missing ?sport param (nba, nfl, mlb, wnba)" }),
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
      body: JSON.stringify({ error: "Invalid sport. Use nba, nfl, mlb, wnba." }),
    };
  }

  console.log(`🔍 Debugging ESPN schedule structure for: ${sport.toUpperCase()}`);
  console.log(`🌐 URL → ${url}`);

  try {
    const response = await axios.get(url, {
      headers: {
        "User-Agent": "Mozilla/5.0",
      },
    });

    const html = response.data;
    const $ = cheerio.load(html);

    // ESPN header (try multiple variants)
    const header =
      $(".Table__Title").first().text().trim() ||
      $("h2").first().text().trim() ||
      "No header detected";

    console.log(`📅 Header found: "${header}"`);

    // Grab all <table> rows (ESPN uses many formats)
    let rows = $("table tbody tr");

    if (rows.length === 0) {
      console.log("⚠️ No <tr> rows found in ESPN schedule HTML.");
      console.log("🪲 Sending HTML snapshot of key structure…");

      const sampleHtml = $.html().slice(0, 1500); // first 1500 chars for debugging

      return {
        statusCode: 200,
        body: JSON.stringify({
          message: "No table rows found - ESPN layout may have changed.",
          header,
          sampleHtml,
        }),
      };
    }

    console.log(`📊 Found ${rows.length} schedule rows`);

    // Extract preview data
    const previews = [];

    rows.each((_, row) => {
      const cols = $(row).find("td");
      if (cols.length < 2) return;

      const matchup = $(cols[0]).text().trim();
      const time = $(cols[1]).text().trim();
      const network = $(cols[2])?.text()?.trim() || "";

      previews.push({
        matchup,
        time,
        network,
      });
    });

    console.log("🔎 First 5 extracted rows:");
    console.log(previews.slice(0, 5));

    return {
      statusCode: 200,
      body: JSON.stringify({
        header,
        count: previews.length,
        previews,
      }),
    };
  } catch (err) {
    console.error("❌ ESPN Scrape Error:", err.message);

    return {
      statusCode: 500,
      body: JSON.stringify({
        error: "Failed to scrape ESPN schedule",
        details: err.message,
      }),
    };
  }
};