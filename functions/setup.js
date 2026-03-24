import express from "express";
import axios from "axios";

const router = express.Router();

function parseBookmakers() {
  const raw = String(process.env.ODDS_API_BOOKMAKERS || "").trim();
  if (!raw) return [];
  return raw.split(",").map((b) => b.trim().toLowerCase()).filter(Boolean);
}

function buildReadiness() {
  const books = parseBookmakers();
  const stripeSecret = Boolean(process.env.STRIPE_SECRET_KEY);
  const stripeWebhook = Boolean(process.env.STRIPE_WEBHOOK_SECRET);
  const oddsKey = Boolean(process.env.ODDS_API_KEY);
  const hasBooks = books.length > 0;
  const fanduel = books.includes("fanduel");
  const rapidApiKey = Boolean(process.env.RAPIDAPI_KEY);
  const rapidApiHost = Boolean(process.env.RAPIDAPI_ODDS_HOST || process.env.RAPIDAPI_HOST);
  const projectId =
    process.env.GCLOUD_PROJECT ||
    process.env.GCP_PROJECT ||
    process.env.FIREBASE_CONFIG ||
    null;

  const score = [
    oddsKey || (rapidApiKey && rapidApiHost),
    hasBooks,
    fanduel,
    stripeSecret,
    stripeWebhook,
    rapidApiKey,
    rapidApiHost,
  ].filter(Boolean).length;

  return {
    checklist: {
      firebaseProjectDetected: Boolean(projectId),
      oddsApiKeyConfigured: oddsKey,
      oddsBookmakersConfigured: hasBooks,
      fanduelIncluded: fanduel,
      stripeSecretConfigured: stripeSecret,
      stripeWebhookConfigured: stripeWebhook,
      rapidApiKeyConfigured: rapidApiKey,
      rapidApiHostConfigured: rapidApiHost,
      rapidApiConfigured: rapidApiKey && rapidApiHost,
      primaryOddsProviderReady: Boolean((rapidApiKey && rapidApiHost) || oddsKey),
    },
    bookmakers: books,
    readinessScore: `${score}/7`,
    notes: [
      !oddsKey && !(rapidApiKey && rapidApiHost) ? "Set RAPIDAPI_KEY + RAPIDAPI_ODDS_HOST (or ODDS_API_KEY) for primary odds provider." : null,
      !hasBooks ? "Set ODDS_API_BOOKMAKERS (comma-separated keys)." : null,
      hasBooks && !fanduel ? "Add fanduel to ODDS_API_BOOKMAKERS for FD coverage." : null,
      !stripeSecret ? "Set STRIPE_SECRET_KEY for memberships." : null,
      !stripeWebhook ? "Set STRIPE_WEBHOOK_SECRET and Stripe endpoint." : null,
      !rapidApiKey ? "Optional: add RAPIDAPI_KEY for second provider failover." : null,
      rapidApiKey && !rapidApiHost ? "Set RAPIDAPI_ODDS_HOST (recommended: odds.p.rapidapi.com)." : null,
    ].filter(Boolean),
  };
}

router.get("/check", (_req, res) => {
  res.json({
    ok: true,
    generatedAt: new Date().toISOString(),
    ...buildReadiness(),
  });
});

function compactDate(dateStr) {
  const value = String(dateStr || "").trim();
  if (/^\d{8}$/.test(value)) return value;
  const d = value ? new Date(value) : new Date();
  if (Number.isNaN(d.getTime())) {
    const n = new Date();
    return `${n.getUTCFullYear()}${String(n.getUTCMonth() + 1).padStart(2, "0")}${String(n.getUTCDate()).padStart(2, "0")}`;
  }
  return `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, "0")}${String(d.getUTCDate()).padStart(2, "0")}`;
}

function providerHost(envKey, fallback) {
  const raw = String(process.env[envKey] || "").trim();
  return raw || fallback;
}

async function probeRapidEndpoint({ key, host, path, params = {} }) {
  const url = `https://${host}${path}`;
  try {
    const response = await axios.get(url, {
      timeout: 12000,
      headers: {
        "x-rapidapi-key": key,
        "x-rapidapi-host": host,
      },
      params,
    });
    return {
      ok: true,
      status: response.status,
      path,
      sampleKeys:
        response?.data && typeof response.data === "object"
          ? Object.keys(response.data).slice(0, 8)
          : [],
    };
  } catch (err) {
    const status = err?.response?.status || null;
    const message = err?.response?.data?.message || err?.response?.data?.error || err.message || "Request failed";
    return { ok: false, status, path, error: String(message).slice(0, 220) };
  }
}

router.get("/rapid-diagnostics", async (req, res) => {
  const rapidKey = String(process.env.RAPIDAPI_KEY || "").trim();
  if (!rapidKey) {
    return res.status(400).json({
      ok: false,
      error: "RAPIDAPI_KEY not configured.",
    });
  }

  const sport = String(req.query.sport || "nba").toLowerCase();
  const gameDate = compactDate(req.query.date);
  const oddsSportMap = {
    nba: "basketball_nba",
    nfl: "americanfootball_nfl",
    mlb: "baseball_mlb",
    wnba: "basketball_wnba",
  };
  const oddsSport = oddsSportMap[sport] || "basketball_nba";

  const providers = [
    {
      key: "live_sports_odds",
      host: providerHost("RAPIDAPI_ODDS_HOST", "odds.p.rapidapi.com"),
      probes: [
        { path: `/v4/sports/${oddsSport}/odds`, params: { regions: "us", oddsFormat: "american", markets: "h2h,spreads,totals" } },
      ],
    },
    {
      key: "tank01_nba",
      host: providerHost("RAPIDAPI_TANK01_NBA_HOST", "tank01-fantasy-stats.p.rapidapi.com"),
      probes: [
        { path: "/getNBAGamesForDate", params: { gameDate } },
        { path: "/getNBATeams", params: {} },
        { path: "/getNBABettingOdds", params: { gameDate } },
        { path: "/getNBAPlayerList", params: {} },
      ],
    },
    {
      key: "tank01_nfl",
      host: providerHost("RAPIDAPI_TANK01_NFL_HOST", "tank01-nfl-live-in-game-real-time-statistics-nfl.p.rapidapi.com"),
      probes: [
        { path: "/getNFLGamesForDate", params: { gameDate } },
        { path: "/getNFLTeams", params: {} },
        { path: "/getNFLBettingOdds", params: { gameDate } },
        { path: "/getNFLPlayerList", params: {} },
      ],
    },
    {
      key: "tank01_mlb",
      host: providerHost("RAPIDAPI_TANK01_MLB_HOST", "tank01-mlb-live-in-game-real-time-statistics.p.rapidapi.com"),
      probes: [
        { path: "/getMLBGamesForDate", params: { gameDate } },
        { path: "/getMLBTeams", params: {} },
        { path: "/getMLBBettingOdds", params: { gameDate } },
        { path: "/getMLBPlayerList", params: {} },
      ],
    },
    {
      key: "tank01_wnba",
      host: providerHost("RAPIDAPI_TANK01_WNBA_HOST", "tank01-wnba-live-in-game-real-time-statistics-wnba.p.rapidapi.com"),
      probes: [
        { path: "/getWNBAGamesForDate", params: { gameDate } },
        { path: "/getWNBATeams", params: {} },
        { path: "/getWNBAPlayerList", params: {} },
      ],
    },
    {
      key: "nba_player_props_odds",
      host: providerHost("RAPIDAPI_NBA_PLAYER_PROPS_HOST", "nba-player-props-odds.p.rapidapi.com"),
      probes: [
        { path: "/odds", params: { date: gameDate } },
        { path: "/player-props", params: { date: gameDate } },
        { path: "/props", params: { date: gameDate } },
      ],
    },
    {
      key: "odds_api_io",
      host: providerHost("RAPIDAPI_ODDS_API_IO_HOST", "odds-api-io-real-time-sports-betting-odds-api.p.rapidapi.com"),
      probes: [
        { path: "/odds", params: { sport } },
        { path: "/v3/odds", params: { sport } },
        { path: "/sports", params: {} },
      ],
    },
    {
      key: "sports_betting_player_props",
      host: providerHost("RAPIDAPI_SPORTS_PLAYER_PROPS_HOST", "sports-betting-player-props.p.rapidapi.com"),
      probes: [
        { path: "/player-props", params: { sport } },
        { path: "/props", params: { sport } },
        { path: "/odds", params: { sport } },
      ],
    },
    {
      key: "nba_smart_bets",
      host: providerHost("RAPIDAPI_NBA_SMART_BETS_HOST", "nba-smart-bets-api.p.rapidapi.com"),
      probes: [
        { path: "/bets", params: {} },
        { path: "/predictions", params: {} },
        { path: "/props", params: {} },
      ],
    },
  ];

  const fullScan = String(req.query.full || "0") === "1";
  const targetProviders = fullScan ? providers : providers.slice(0, 1);

  const diagnostics = [];
  for (const provider of targetProviders) {
    const probeResults = [];
    for (const probe of provider.probes) {
      probeResults.push(await probeRapidEndpoint({
        key: rapidKey,
        host: provider.host,
        path: probe.path,
        params: probe.params,
      }));
    }
    diagnostics.push({
      provider: provider.key,
      host: provider.host,
      okCount: probeResults.filter((x) => x.ok).length,
      probeCount: probeResults.length,
      probes: probeResults,
    });
  }

  const totalOk = diagnostics.reduce((sum, d) => sum + d.okCount, 0);
  const totalProbes = diagnostics.reduce((sum, d) => sum + d.probeCount, 0);

  return res.json({
    ok: true,
    generatedAt: new Date().toISOString(),
    mode: fullScan ? "full" : "lite",
    sport,
    gameDate,
    summary: {
      providerCount: diagnostics.length,
      totalOk,
      totalProbes,
    },
    note: fullScan
      ? "Full diagnostics runs all providers and uses more requests."
      : "Lite diagnostics only probes Live Sports Odds to conserve requests.",
    diagnostics,
  });
});

export { router };
