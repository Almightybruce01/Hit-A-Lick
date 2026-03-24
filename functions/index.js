// index.js — ESM entry (see package.json "type": "module")
import { onRequest } from "firebase-functions/v2/https";
import admin from "firebase-admin";
import express from "express";
import cors from "cors";

import * as nba from "./sportsdataapi/nba.js";
import * as nfl from "./sportsdataapi/nfl.js";
import * as mlb from "./sportsdataapi/mlb.js";
import * as wnba from "./sportsdataapi/wnba.js";
import * as liveGame from "./sportsdataapi/liveGame.js";
import * as props from "./sportsdataapi/props.js";
import * as playerStats from "./sportsdataapi/playerStats.js";
import * as teamStats from "./sportsdataapi/teamStats.js";
import * as players from "./sportsdataapi/players.js";
import * as teams from "./sportsdataapi/teams.js";
import * as upcomingGames from "./sportsdataapi/upcomingGames.js";
import * as gamesMod from "./sportsdataapi/games.js";
import * as billing from "./billing.js";
import * as picks from "./picks.js";
import * as curators from "./curators.js";
import * as ai from "./ai.js";
import * as setup from "./setup.js";
import * as elite from "./elite.js";
import * as cacheLiveGameMod from "./sportsdataapi/cacheLiveGame.js";
import * as cacheUpcomingGamesMod from "./sportsdataapi/cacheUpcomingGames.js";
import * as cacheStatsMod from "./sportsdataapi/cacheStats.js";
import * as teamScraperMod from "./sportsdataapi/teamScraper.js";
import * as playerScraperMod from "./sportsdataapi/playerScraper.js";
import * as sportSetupMod from "./sportsdataapi/sportSetup.js";
import * as eliteScheduler from "./eliteScheduler.js";
import * as dataRetention from "./dataRetention.js";
import { buildOpsInsightsPayload } from "./opsInsights.js";

if (!admin.apps.length) {
  admin.initializeApp();
}

const app = express();
app.set("trust proxy", 1);
app.use(cors({ origin: true }));
app.use(express.json({ limit: "512kb" }));

function configuredBookmakersList() {
  const raw = String(process.env.ODDS_API_BOOKMAKERS || "").trim();
  if (!raw) return [];
  return raw
    .split(",")
    .map((b) => b.trim().toLowerCase())
    .filter(Boolean);
}

function rapidProviderConfigured() {
  const key = String(process.env.RAPIDAPI_KEY || "").trim();
  const host = String(process.env.RAPIDAPI_ODDS_HOST || process.env.RAPIDAPI_HOST || "").trim();
  return {
    rapidApiConfigured: Boolean(key && host),
    rapidApiHost: host || null,
  };
}

app.get("/health", (_req, res) => {
  res.status(200).json({
    ok: true,
    service: "hitalick-api",
    ts: new Date().toISOString(),
  });
});
app.get("/api/health", (_req, res) => {
  res.status(200).json({
    ok: true,
    service: "hitalick-api",
    ts: new Date().toISOString(),
  });
});
app.get("/status", (_req, res) => {
  const books = configuredBookmakersList();
  const rapid = rapidProviderConfigured();
  res.status(200).json({
    ok: true,
    service: "hitalick-api",
    ts: new Date().toISOString(),
    provider: {
      oddsApiConfigured: Boolean(process.env.ODDS_API_KEY),
      bookmakersConfigured: Boolean(process.env.ODDS_API_BOOKMAKERS),
      bookmakers: books,
      fanduelConfigured: books.includes("fanduel"),
      ...rapid,
    },
  });
});
app.get("/api/status", (_req, res) => {
  const books = configuredBookmakersList();
  const rapid = rapidProviderConfigured();
  res.status(200).json({
    ok: true,
    service: "hitalick-api",
    ts: new Date().toISOString(),
    provider: {
      oddsApiConfigured: Boolean(process.env.ODDS_API_KEY),
      bookmakersConfigured: Boolean(process.env.ODDS_API_BOOKMAKERS),
      bookmakers: books,
      fanduelConfigured: books.includes("fanduel"),
      ...rapid,
    },
  });
});

async function sendOpsDashboard(_req, res) {
  try {
    const mod = await import("./sportsdataapi/propMarketTuning.js");
    const tier = mod.propMarketTierFromEnv();
    const meta = mod.propMarketTierMeta(tier);
    const sports = ["nba", "nfl", "mlb", "wnba"];
    const marketsBySport = {};
    for (const s of sports) {
      marketsBySport[s] = mod.resolvePlayerPropMarketsForSport(s, tier);
    }
    let opsHeartbeat = null;
    try {
      const snap = await admin.firestore().collection("_ops").doc("dailyLiveOps").get();
      opsHeartbeat = snap.exists ? snap.data() : null;
    } catch (_) {
      opsHeartbeat = null;
    }
    res.status(200).json({
      ok: true,
      generatedAt: new Date().toISOString(),
      service: "hitalick-ops",
      env: {
        oddsApiKeyPresent: Boolean(process.env.ODDS_API_KEY),
        rapidApiConfigured: Boolean(process.env.RAPIDAPI_KEY && process.env.RAPIDAPI_ODDS_HOST),
        activePropMarketTier: tier,
        propMarketTierDescription: meta,
      },
      marketsBySport,
      typicalPricedLegsPerSlateRetail: {
        nba: "18–26",
        wnba: "16–22",
        nfl: "22–34",
        mlb: "12–20",
      },
      notes: [
        "Player legs strip `synthetic` rows when present; ESPN/Rapid recovery paths enrich headshots.",
        "Firestore `props` collection pruned post-game (scheduled + each live pull).",
      ],
      opsHeartbeat,
      aiOpsInsights: {
        path: "/api/ops/insights",
        auth: "X-Ops-Pin (OPS_DASHBOARD_PIN, default 5505) or Authorization: Bearer <owner Firebase ID token>",
        description: "Rule-based diagnostics + optional OpenAI narrative (OPENAI_API_KEY).",
      },
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message || "ops dashboard failed" });
  }
}
function opsDashboardPinExpected() {
  return String(process.env.OPS_DASHBOARD_PIN || "5505").trim();
}

/**
 * Ops JSON routes: Firebase owner Bearer **or** `X-Ops-Pin` matching `OPS_DASHBOARD_PIN` (default 5505).
 * Set `OPS_DASHBOARD_PIN` in Firebase secrets for production; public static dashboard never embeds the PIN.
 */
async function requireOwnerOrOpsPin(req, res, next) {
  const pinHeader = String(req.headers["x-ops-pin"] || req.headers["X-Ops-Pin"] || "").trim();
  if (pinHeader && pinHeader === opsDashboardPinExpected()) {
    req.opsPinAuth = true;
    return next();
  }
  try {
    const authHeader = req.headers.authorization || "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
    if (!token) {
      return res.status(401).json({ error: "Use X-Ops-Pin header or owner Bearer token." });
    }
    const decoded = await admin.auth().verifyIdToken(token);
    const owner = (process.env.OWNER_EMAIL || "brucebrian50@gmail.com").toLowerCase();
    if ((decoded.email || "").toLowerCase() !== owner) {
      return res.status(403).json({ error: "Owner access only." });
    }
    req.opsOwnerAuth = true;
    return next();
  } catch (error) {
    return res.status(401).json({ error: "Invalid auth token." });
  }
}

app.get("/ops/dashboard", requireOwnerOrOpsPin, sendOpsDashboard);
app.get("/api/ops/dashboard", requireOwnerOrOpsPin, sendOpsDashboard);

async function sendOpsInsights(_req, res) {
  try {
    const payload = await buildOpsInsightsPayload();
    res.status(200).json(payload);
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message || "ops insights failed" });
  }
}

app.get("/ops/insights", requireOwnerOrOpsPin, sendOpsInsights);
app.get("/api/ops/insights", requireOwnerOrOpsPin, sendOpsInsights);

app.get("/api/ops/universal-pool", requireOwnerOrOpsPin, async (req, res) => {
  try {
    const items = await curators.loadUniversalPickPoolForOps();
    res.json({ items });
  } catch (e) {
    res.status(500).json({ error: e.message || "pool load failed" });
  }
});

app.post("/api/ops/curator-board/select", requireOwnerOrOpsPin, async (req, res) => {
  try {
    const curatorId = req.body?.curatorId;
    const pickIds = req.body?.pickIds;
    const by = req.opsOwnerAuth ? "owner-bearer" : "ops-pin";
    const count = await curators.applyCuratorBoardSelectionForOps(curatorId, pickIds, by);
    res.json({ ok: true, count });
  } catch (e) {
    res.status(400).json({ error: e.message || "board select failed" });
  }
});

function wrapLambdaHandler(lambdaModule) {
  return async (req, res) => {
    try {
      if (!lambdaModule || typeof lambdaModule.handler !== "function") {
        return res.status(500).json({ error: "Invalid route handler module." });
      }

      const event = {
        httpMethod: req.method,
        path: req.path,
        headers: req.headers || {},
        queryStringParameters: req.query || {},
        body: req.body ? JSON.stringify(req.body) : undefined,
      };

      const result = await lambdaModule.handler(event);

      if (result && typeof result.statusCode === "number") {
        if (result.headers && typeof result.headers === "object") {
          res.set(result.headers);
        }

        const body = result.body;
        if (typeof body === "string") {
          try {
            return res.status(result.statusCode).json(JSON.parse(body));
          } catch {
            return res.status(result.statusCode).send(body);
          }
        }

        return res.status(result.statusCode).json(body ?? {});
      }

      return res.json(result ?? {});
    } catch (error) {
      return res.status(500).json({
        error: error.message || "Unhandled route error",
      });
    }
  };
}

app.all("/nba", wrapLambdaHandler(nba));
app.all("/nfl", wrapLambdaHandler(nfl));
app.all("/mlb", wrapLambdaHandler(mlb));
app.all("/wnba", wrapLambdaHandler(wnba));
app.all("/liveGame", wrapLambdaHandler(liveGame));
app.all("/props", wrapLambdaHandler(props));
app.all("/playerStats", wrapLambdaHandler(playerStats));
app.all("/teamStats", wrapLambdaHandler(teamStats));
app.all("/players", wrapLambdaHandler(players));
app.all("/teams", wrapLambdaHandler(teams));
app.all("/upcomingGames", wrapLambdaHandler(upcomingGames));
app.all("/games", wrapLambdaHandler(gamesMod));
app.get("/scrapeTeams", async (req, res) => {
  const sport = req.query.sport?.toLowerCase() || "";
  const result = await teamScraperMod.handler({ queryStringParameters: { sport } });
  res.status(result.statusCode || 500).send(result.body ?? "");
});
app.get("/scrapePlayers", async (req, res) => {
  const sport = req.query.sport?.toLowerCase() || "";
  const result = await playerScraperMod.handler({ queryStringParameters: { sport } });
  res.status(result.statusCode || 500).send(result.body ?? "");
});
app.use("/billing", billing.router);
app.use("/picks", picks.router);
app.use("/ai", ai.router);
app.use("/setup", setup.router);
app.use("/elite", elite.router);

app.all("/api/nba", wrapLambdaHandler(nba));
app.all("/api/nfl", wrapLambdaHandler(nfl));
app.all("/api/mlb", wrapLambdaHandler(mlb));
app.all("/api/wnba", wrapLambdaHandler(wnba));
app.all("/api/liveGame", wrapLambdaHandler(liveGame));
app.all("/api/props", wrapLambdaHandler(props));
app.all("/api/playerStats", wrapLambdaHandler(playerStats));
app.all("/api/teamStats", wrapLambdaHandler(teamStats));
app.all("/api/players", wrapLambdaHandler(players));
app.all("/api/teams", wrapLambdaHandler(teams));
app.all("/api/upcomingGames", wrapLambdaHandler(upcomingGames));
app.all("/api/games", wrapLambdaHandler(gamesMod));
app.use("/api/billing", billing.router);
app.use("/api/picks", picks.router);
app.use("/api/curators", curators.router);
app.use("/api/ai", ai.router);
app.use("/api/setup", setup.router);
app.use("/api/elite", elite.router);

app.use((req, res) => {
  res.status(404).json({
    ok: false,
    error: "Not found",
    path: req.originalUrl || req.url,
    method: req.method,
  });
});

const stripeSecrets = [
  "STRIPE_SECRET_KEY",
  "STRIPE_WEBHOOK_SECRET",
  "STRIPE_PRICE_BRUCE_MONTHLY",
  "STRIPE_PRICE_BRUCE_ANNUAL",
  "STRIPE_PRICE_BRUCE_ELITE_VIP",
  "STRIPE_PRICE_CORE_MONTHLY",
  "STRIPE_PRICE_BRUCE_PICKS_MONTHLY",
  "STRIPE_PRICE_BRUCE_PREMIUM_MONTHLY",
  "ODDS_API_KEY",
  "ODDS_API_BOOKMAKERS",
  "RAPIDAPI_KEY",
  "RAPIDAPI_ODDS_HOST",
  "RAPIDAPI_TANK01_NBA_HOST",
  "RAPIDAPI_TANK01_NFL_HOST",
  "RAPIDAPI_TANK01_MLB_HOST",
  "RAPIDAPI_TANK01_WNBA_HOST",
  "RAPIDAPI_NBA_PLAYER_PROPS_HOST",
  "RAPIDAPI_ODDS_API_IO_HOST",
  "RAPIDAPI_SPORTS_PLAYER_PROPS_HOST",
  "RAPIDAPI_NBA_SMART_BETS_HOST",
];

export const api = onRequest({ secrets: stripeSecrets }, app);

export const cacheLiveGame = cacheLiveGameMod.cacheLiveGame;
export const prewarmGames = gamesMod.prewarmGames;
export const cacheUpcomingGames = cacheUpcomingGamesMod.cacheUpcomingGames;
export const cacheStats = cacheStatsMod.cacheStats;
export const scrapeTeams = teamScraperMod.scrapeTeams;
export const scrapePlayers = playerScraperMod.scrapePlayers;
export const setupSports = sportSetupMod.setupSports;
export const processEliteAlerts = eliteScheduler.processEliteAlerts;
export const pruneHistoricalData = dataRetention.pruneHistoricalData;
export const dailyLiveOpsTick = dataRetention.dailyLiveOpsTick;
export const propExpirySweep = dataRetention.propExpirySweep;

export const stripeWebhook = onRequest({ secrets: stripeSecrets }, billing.handleStripeWebhook);
