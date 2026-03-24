import axios from "axios";

function formatGame(event) {
  const comp = event?.competitions?.[0] || {};
  const home = (comp.competitors || []).find((c) => c.homeAway === "home")?.team?.displayName || "Home";
  const away = (comp.competitors || []).find((c) => c.homeAway === "away")?.team?.displayName || "Away";
  const oddsObj = comp.odds?.[0] || {};
  const odds = oddsObj.details || "N/A";
  const venue = comp.venue?.fullName || event?.shortName || "TBD";
  const dt = event?.date ? new Date(event.date) : null;
  const date = dt ? dt.toISOString().split("T")[0] : new Date().toISOString().split("T")[0];
  const time = dt
    ? dt.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false })
    : "00:00";

  return { date, time, homeTeam: home, awayTeam: away, odds, venue };
}

export const handler = async () => {
  try {
    const { data } = await axios.get(
      "https://site.api.espn.com/apis/site/v2/sports/baseball/mlb/scoreboard",
      { timeout: 12000 }
    );
    const games = Array.isArray(data?.events) ? data.events.map(formatGame) : [];
    return { statusCode: 200, body: JSON.stringify(games) };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: `Failed to fetch MLB games: ${err.message}` }) };
  }
};