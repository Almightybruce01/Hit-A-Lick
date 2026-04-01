import express from "express";
import admin from "firebase-admin";
import {
  mergeStaffEntitlement,
  hydrateEntitlementForApi,
  isUnlimitedStaffEmail,
  staffLabelForEmail,
} from "./billing.js";

const router = express.Router();

/** Regular ($19.99/mo) app access: included AI Copilot + picks calls per month before paywall / credit packs. */
const FREE_AI_REQUESTS_MONTHLY = 5;

function americanToDecimal(americanOdds) {
  const n = Number(americanOdds);
  if (!Number.isFinite(n) || n === 0) return null;
  if (n > 0) return 1 + n / 100;
  return 1 + 100 / Math.abs(n);
}

/** American or European decimal (e.g. 1.91) → payout multiplier (decimal odds). */
function rawOddsToDecimalPrice(raw) {
  const s = String(raw ?? "")
    .trim()
    .replace(/−/g, "-")
    .replace(/＋/g, "+");
  const n = Number(s);
  if (!Number.isFinite(n) || n === 0) return null;
  if (n > 1.01 && n < 50 && !Number.isInteger(n)) return n;
  if (n > 0) return 1 + n / 100;
  return 1 + 100 / Math.abs(n);
}

function decimalPriceToAmerican(dec) {
  if (!Number.isFinite(dec) || dec < 1.0001) return null;
  if (dec >= 2) return Math.round((dec - 1) * 100);
  return Math.round(-100 / (dec - 1));
}

function impliedProbabilityFromAmerican(americanOdds) {
  const n = Number(americanOdds);
  if (!Number.isFinite(n) || n === 0) return null;
  if (n > 0) return 100 / (n + 100);
  return Math.abs(n) / (Math.abs(n) + 100);
}

function subscriptionGrantsUnlimitedAi(entitlement = {}) {
  if (entitlement.aiUnlimited === true) return true;
  if (entitlement.active !== true) return false;
  if (entitlement.hasPremium === true && entitlement.hasAppAccess === true) return true;
  const tier = String(entitlement.tier || "").toLowerCase();
  if (tier === "staff" || tier === "premium_ai") return true;
  return false;
}

async function verifyUidToken(req) {
  const authHeader = req.headers.authorization || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
  const uid = String(req.body?.uid || req.query?.uid || "").trim();
  if (!token || !uid) {
    return { error: 401, message: "Auth token and uid are required." };
  }
  const decoded = await admin.auth().verifyIdToken(token);
  if (decoded.uid !== uid) {
    return { error: 403, message: "Token uid mismatch." };
  }
  return { uid, email: (decoded.email || "").toLowerCase() };
}

async function readAiQuotaState(uid) {
  const monthKey = new Date().toISOString().slice(0, 7);
  const ref = admin.firestore().collection("users").doc(uid).collection("privateStats").doc("aiMonthly");
  const snap = await ref.get();
  const d = snap.exists ? snap.data() || {} : {};
  const used = d.monthKey === monthKey ? Number(d.used || 0) : 0;
  const purchased = d.monthKey === monthKey ? Number(d.purchasedCredits || 0) : 0;
  return { monthKey, used, purchased, limit: FREE_AI_REQUESTS_MONTHLY + purchased, ref };
}

/**
 * @returns {"unlimited"|"subscription"|"metered"|"deny"}
 */
async function classifyAiAccess(uid, email) {
  if (isUnlimitedStaffEmail(email)) return "unlimited";
  const e = String(email || "").toLowerCase();

  const userSnap = await admin.firestore().collection("users").doc(uid).get();
  const rawEnt = userSnap.exists ? userSnap.data()?.entitlement || {} : {};
  const entitlement = hydrateEntitlementForApi(mergeStaffEntitlement({ ...rawEnt }, e));
  if (entitlement.aiUnlimited === true) return "unlimited";
  if (subscriptionGrantsUnlimitedAi(entitlement)) return "unlimited";

  if (!entitlement.hasAppAccess) return "deny_no_subscription";

  const { used, limit } = await readAiQuotaState(uid);
  if (used >= limit) return "deny_quota";
  return "metered";
}

async function incrementMeteredAiQuota(uid) {
  const monthKey = new Date().toISOString().slice(0, 7);
  const ref = admin.firestore().collection("users").doc(uid).collection("privateStats").doc("aiMonthly");
  await admin.firestore().runTransaction(async (t) => {
    const snap = await t.get(ref);
    const d = snap.exists ? snap.data() || {} : {};
    const used = d.monthKey === monthKey ? Number(d.used || 0) : 0;
    const purchased = d.monthKey === monthKey ? Number(d.purchasedCredits || 0) : 0;
    const cap = FREE_AI_REQUESTS_MONTHLY + purchased;
    if (used >= cap) {
      const err = new Error("QUOTA_EXCEEDED");
      err.code = "QUOTA_EXCEEDED";
      throw err;
    }
    t.set(
      ref,
      {
        monthKey,
        used: used + 1,
        purchasedCredits: purchased,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
  });
}

router.get("/quota", async (req, res) => {
  try {
    const v = await verifyUidToken(req);
    if (v.error) return res.status(v.error).json({ error: v.message });
    const { uid, email } = v;

    if (isUnlimitedStaffEmail(email)) {
      return res.json({
        unlimited: true,
        freeMonthly: FREE_AI_REQUESTS_MONTHLY,
        staff: staffLabelForEmail(email),
      });
    }

    const userSnap = await admin.firestore().collection("users").doc(uid).get();
    const rawEnt = userSnap.exists ? userSnap.data()?.entitlement || {} : {};
    const entitlement = hydrateEntitlementForApi(mergeStaffEntitlement({ ...rawEnt }, email));
    if (subscriptionGrantsUnlimitedAi(entitlement)) {
      return res.json({
        unlimited: true,
        freeMonthly: FREE_AI_REQUESTS_MONTHLY,
        aiTier: "premium",
      });
    }

    const { monthKey, used, limit } = await readAiQuotaState(uid);
    const appOk = Boolean(entitlement.hasAppAccess);
    if (!appOk) {
      const needRegularOnly = entitlement.hasPremium === true && entitlement.hasRegular !== true;
      return res.json({
        unlimited: false,
        locked: true,
        reason: needRegularOnly ? "needs_regular_before_ai_addon" : "needs_app_subscription",
        freeMonthly: FREE_AI_REQUESTS_MONTHLY,
        used: 0,
        limit: 0,
        remaining: 0,
        upgradeUrl: process.env.APP_PRICING_URL || "https://hit-a-lick-database.web.app/pricing.html",
      });
    }

    return res.json({
      unlimited: false,
      locked: false,
      monthKey,
      used,
      limit,
      remaining: Math.max(0, limit - used),
      freeMonthly: FREE_AI_REQUESTS_MONTHLY,
      aiTier: "regular",
      upgradeUrl: process.env.APP_PRICING_URL || "https://hit-a-lick-database.web.app/pricing.html",
    });
  } catch (e) {
    res.status(401).json({ error: e.message || "Invalid auth token." });
  }
});

/** Public: last scheduled "AI plays of the day" snapshot (written daily ~6am local, see `publishDailyAiPlays`). */
router.get("/plays-of-day", async (_req, res) => {
  try {
    const snap = await admin.firestore().collection("systemSettings").doc("aiPlaysDaily").get();
    if (!snap.exists) {
      return res.json({
        ok: true,
        picks: [],
        dateKey: null,
        generatedAt: null,
        timeZone: null,
        empty: true,
      });
    }
    const d = snap.data() || {};
    let generatedAtIso = null;
    if (d.generatedAt?.toDate) generatedAtIso = d.generatedAt.toDate().toISOString();
    const picks = Array.isArray(d.picks) ? d.picks : [];
    return res.json({
      ok: true,
      picks,
      dateKey: d.dateKey || null,
      timeZone: d.timeZone || null,
      generatedAt: generatedAtIso,
      empty: picks.length === 0,
    });
  } catch (e) {
    res.status(500).json({ error: e.message || "plays-of-day failed" });
  }
});

async function logAiInteraction(uid, kind, payload) {
  try {
    await admin.firestore().collection("aiInteractionLog").add({
      uid,
      kind,
      ...payload,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });
  } catch {
    /* non-fatal */
  }
}

function propMarketShortLabelServer(key) {
  const k = String(key || "").toLowerCase();
  if (!k) return "PROP";
  const map = {
    player_points: "PTS",
    player_rebounds: "REB",
    player_assists: "AST",
    player_threes: "3PM",
    player_blocks: "BLK",
    player_steals: "STL",
    player_turnovers: "TO",
    player_points_rebounds_assists: "PRA",
    player_points_rebounds: "P+R",
    player_points_assists: "P+A",
    player_rebounds_assists: "R+A",
    player_pass_yds: "PASS YDS",
    player_rush_yds: "RUSH",
    player_receptions: "REC",
  };
  if (map[k]) return map[k];
  return k.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function legOuSideLabelServer(side) {
  const s = String(side || "").toLowerCase().trim();
  if (!s) return "";
  if (s === "over" || s === "o") return "Over";
  if (s === "under" || s === "u") return "Under";
  if (s.includes("over")) return "Over";
  if (s.includes("under")) return "Under";
  return "";
}

function inferOuFromLabelServer(label) {
  const s = String(label || "");
  if (/\bOver\b/i.test(s) && !/\bUnder\b/i.test(s)) return "Over";
  if (/\bUnder\b/i.test(s)) return "Under";
  return "";
}

function inferNumericLineFromLabelServer(label) {
  const s = String(label || "").trim();
  const trailing = s.match(/(\d+(?:\.\d+)?)\s*$/);
  if (trailing) return trailing[1];
  const embedded = s.match(/\b(\d+(?:\.\d+)?)\b/g);
  if (embedded?.length) return embedded[embedded.length - 1];
  return "";
}

function buildLegReadableLineServer(leg) {
  const mk = propMarketShortLabelServer(leg.market);
  let ou = legOuSideLabelServer(leg.side);
  if (!ou) ou = inferOuFromLabelServer(leg.label);
  let line = leg.line != null && leg.line !== "" ? String(leg.line) : "";
  if (!line) line = inferNumericLineFromLabelServer(leg.label);
  return [ou, line, mk].filter(Boolean).join(" ");
}

function confidenceFromOdds(odds) {
  return Number(((1 - (impliedProbabilityFromAmerican(odds) || 0.5)) * 100).toFixed(1));
}

function buildCandidatesFromProp(prop, allowedBooks) {
  const candidates = [];
  const books = Array.isArray(prop.books) ? prop.books : [];

  for (const book of books) {
    if (allowedBooks.length && !allowedBooks.includes(book.bookmakerKey)) continue;
    const mkts = book.markets || {};

    for (const moneyline of mkts.moneyline || []) {
      if (!Number.isFinite(Number(moneyline.odds))) continue;
      candidates.push({
        type: "moneyline",
        label: `${prop.matchup} • ${moneyline.side} ML`,
        matchup: prop.matchup,
        side: moneyline.side,
        line: null,
        odds: Number(moneyline.odds),
        book: book.bookmakerName,
        bookKey: book.bookmakerKey,
        confidence: Number(((1 - (impliedProbabilityFromAmerican(moneyline.odds) || 0.5)) * 100).toFixed(1)),
      });
    }

    for (const spread of mkts.spread || []) {
      if (!Number.isFinite(Number(spread.odds)) || spread.line == null) continue;
      candidates.push({
        type: "spread",
        label: `${prop.matchup} • ${spread.side} ${Number(spread.line).toFixed(1)}`,
        matchup: prop.matchup,
        side: spread.side,
        line: Number(spread.line).toFixed(1),
        odds: Number(spread.odds),
        book: book.bookmakerName,
        bookKey: book.bookmakerKey,
        confidence: Number(((1 - (impliedProbabilityFromAmerican(spread.odds) || 0.5)) * 100).toFixed(1)),
      });
    }

    for (const total of mkts.total || []) {
      if (!Number.isFinite(Number(total.odds)) || total.line == null) continue;
      candidates.push({
        type: "total",
        label: `${prop.matchup} • ${total.side} ${Number(total.line).toFixed(1)}`,
        matchup: prop.matchup,
        side: total.side,
        line: Number(total.line).toFixed(1),
        odds: Number(total.odds),
        book: book.bookmakerName,
        bookKey: book.bookmakerKey,
        confidence: Number(((1 - (impliedProbabilityFromAmerican(total.odds) || 0.5)) * 100).toFixed(1)),
      });
    }
  }

  for (const leg of prop.playerProps || []) {
    if (!leg || leg.synthetic || leg.projected) continue;
    const odds = Number(leg.odds);
    if (!Number.isFinite(odds)) continue;
    const bk = String(leg.bookKey || "").toLowerCase();
    if (allowedBooks.length && bk && !allowedBooks.includes(bk)) continue;
    const readable = leg.readableLine || buildLegReadableLineServer(leg);
    const rawName = String(leg.playerName || "").trim();
    const fromLabel = String(leg.label || "")
      .replace(/\s+(Over|Under)$/i, "")
      .replace(/\s+(\d+(?:\.\d+)?)\s*$/, "")
      .trim();
    const head = rawName || fromLabel || "Player";
    const legConf = Number(leg.confidence);
    const confidence = Number.isFinite(legConf) ? legConf : confidenceFromOdds(odds);
    candidates.push({
      type: "player_prop",
      label: `${head} · ${readable}`,
      matchup: prop.matchup,
      market: leg.market || null,
      side: leg.side || null,
      line: leg.line != null && leg.line !== "" ? leg.line : inferNumericLineFromLabelServer(leg.label) || null,
      readableLine: readable,
      odds,
      book: leg.bookName,
      bookKey: leg.bookKey,
      confidence,
    });
  }

  return candidates;
}

router.post("/picks", async (req, res) => {
  try {
    const v = await verifyUidToken(req);
    if (v.error) return res.status(v.error).json({ error: v.message });
    const { uid, email } = v;

    const access = await classifyAiAccess(uid, email);
    if (access === "deny_no_subscription") {
      return res.status(403).json({
        error: "Subscribe to Hit-A-Lick Regular or Premium on the website to unlock AI.",
        code: "NEEDS_APP_SUBSCRIPTION",
        upgradeUrl: process.env.APP_PRICING_URL || "https://hit-a-lick-database.web.app/pricing.html",
      });
    }
    if (access === "deny_quota") {
      const { monthKey, used, limit } = await readAiQuotaState(uid);
      return res.status(402).json({
        error: "Monthly AI request limit reached (50 included with Regular). Upgrade to Premium for unlimited AI.",
        code: "AI_QUOTA_EXCEEDED",
        freeMonthly: FREE_AI_REQUESTS_MONTHLY,
        used,
        limit,
        monthKey,
        upgradeUrl: process.env.APP_PRICING_URL || "https://hit-a-lick-database.web.app/pricing.html",
      });
    }

    const sport = String(req.body?.sport || "nba").toLowerCase();
    const minConfidence = Math.max(0, Math.min(100, Number(req.body?.minConfidence || 55)));
    const maxPicks = Math.max(1, Math.min(20, Number(req.body?.maxPicks || 8)));
    const preferredBooks = Array.isArray(req.body?.preferredBooks)
      ? req.body.preferredBooks.map((s) => String(s).toLowerCase())
      : [];

    const snap = await admin.firestore().collection("props").where("sport", "==", sport).limit(300).get();
    const props = snap.docs.map((doc) => doc.data() || {});

    let candidates = [];
    for (const prop of props) {
      candidates = candidates.concat(buildCandidatesFromProp(prop, preferredBooks));
    }

    const filtered = candidates
      .filter((c) => Number.isFinite(c.confidence) && c.confidence >= minConfidence)
      .sort((a, b) => b.confidence - a.confidence)
      .slice(0, maxPicks);

    let withPayout = filtered.map((pick) => {
      const dec = americanToDecimal(pick.odds);
      return {
        ...pick,
        decimalOdds: dec,
        impliedProbability: impliedProbabilityFromAmerican(pick.odds),
      };
    });

    if (!withPayout.length) {
      withPayout = [
        {
          type: "spread",
          label: `${sport.toUpperCase()} Preview • Favorite -3.5`,
          matchup: "Preview Matchup A",
          side: "Favorite",
          line: "-3.5",
          odds: -110,
          book: "DraftKings",
          bookKey: "draftkings",
          confidence: 62.4,
          decimalOdds: americanToDecimal(-110),
          impliedProbability: impliedProbabilityFromAmerican(-110),
          preview: true,
        },
        {
          type: "total",
          label: `${sport.toUpperCase()} Preview • Over 221.5`,
          matchup: "Preview Matchup B",
          side: "Over",
          line: "221.5",
          odds: -105,
          book: "FanDuel",
          bookKey: "fanduel",
          confidence: 60.1,
          decimalOdds: americanToDecimal(-105),
          impliedProbability: impliedProbabilityFromAmerican(-105),
          preview: true,
        },
      ];
    }

    const withSport = withPayout.map((p) => ({ ...p, sport }));

    if (access === "metered") {
      try {
        await incrementMeteredAiQuota(uid);
      } catch (e) {
        if (e.code === "QUOTA_EXCEEDED" || e.message === "QUOTA_EXCEEDED") {
          const st = await readAiQuotaState(uid);
          return res.status(402).json({
            error: "Monthly AI request limit reached.",
            freeMonthly: FREE_AI_REQUESTS_MONTHLY,
            used: st.used,
            limit: st.limit,
            monthKey: st.monthKey,
          });
        }
        throw e;
      }
    }

    const afterMetered = access === "metered" ? await readAiQuotaState(uid) : null;

    await logAiInteraction(uid, "picks", {
      sport,
      minConfidence,
      maxPicks,
      pickCount: withSport.length,
      hadPreviewOnly: Boolean(withSport.every((x) => x.preview)),
    });

    return res.json({
      sport,
      minConfidence,
      picks: withSport,
      aiQuota:
        access === "unlimited"
          ? { unlimited: true }
          : {
              unlimited: false,
              monthKey: afterMetered?.monthKey,
              used: afterMetered?.used,
              limit: afterMetered?.limit,
            },
      note: "AI board generated from odds snapshots and confidence ranking model.",
    });
  } catch (error) {
    return res.status(500).json({ error: error.message || "Failed to generate picks." });
  }
});

router.post("/copilot", async (req, res) => {
  try {
    const v = await verifyUidToken(req);
    if (v.error) return res.status(v.error).json({ error: v.message });
    const { uid, email } = v;

    const access = await classifyAiAccess(uid, email);
    if (access === "deny_no_subscription") {
      return res.status(403).json({
        error: "Subscribe on the website to unlock AI Copilot.",
        code: "NEEDS_APP_SUBSCRIPTION",
        upgradeUrl: process.env.APP_PRICING_URL || "https://hit-a-lick-database.web.app/pricing.html",
      });
    }
    if (access === "deny_quota") {
      const { monthKey, used, limit } = await readAiQuotaState(uid);
      return res.status(402).json({
        error: "AI request limit reached. Upgrade to Premium for unlimited AI.",
        code: "AI_QUOTA_EXCEEDED",
        freeMonthly: FREE_AI_REQUESTS_MONTHLY,
        used,
        limit,
        monthKey,
        upgradeUrl: process.env.APP_PRICING_URL || "https://hit-a-lick-database.web.app/pricing.html",
      });
    }

    const msg = String(req.body?.message || "").slice(0, 2000);
    const sportParam = String(req.body?.sport || "nba").toLowerCase();
    let sport = ["nba", "nfl", "mlb", "wnba"].includes(sportParam) ? sportParam : "nba";
    let minConfidence = 58;
    let maxPicks = 7;
    const m = msg.toLowerCase();
    for (const sp of ["nba", "nfl", "mlb", "wnba"]) {
      if (m.includes(sp)) {
        sport = sp;
        break;
      }
    }
    if (m.includes("aggressive") || m.includes("longshot") || m.includes("chase")) minConfidence = 48;
    if (m.includes("safe") || m.includes("conservative") || m.includes("bank")) minConfidence = 68;
    if (m.includes("few") || m.includes("one pick") || m.includes("two leg") || m.includes("2 leg")) maxPicks = 3;
    if (m.includes("deep") || m.includes("full slate") || m.includes("lotto")) maxPicks = 14;
    const legMatch = m.match(/(\d+)\s*[- ]?leg/);
    if (legMatch) {
      const n = Math.min(20, Math.max(2, parseInt(legMatch[1], 10)));
      maxPicks = Math.min(20, Math.max(3, n));
    }
    if (m.includes("parlay") || m.includes("sgp") || m.includes("same game") || m.includes("same-game")) {
      maxPicks = Math.min(maxPicks, 5);
      minConfidence = Math.min(minConfidence, 56);
    }
    if ((m.includes("single") || m.includes("singles")) && !m.includes("single game")) {
      maxPicks = Math.min(maxPicks, 6);
      minConfidence = Math.max(minConfidence, 60);
    }

    if (access === "metered") {
      try {
        await incrementMeteredAiQuota(uid);
      } catch (e) {
        if (e.code === "QUOTA_EXCEEDED" || e.message === "QUOTA_EXCEEDED") {
          const st = await readAiQuotaState(uid);
          return res.status(402).json({
            error: "Monthly AI request limit reached.",
            freeMonthly: FREE_AI_REQUESTS_MONTHLY,
            used: st.used,
            limit: st.limit,
            monthKey: st.monthKey,
          });
        }
        throw e;
      }
    }
    const afterMetered = access === "metered" ? await readAiQuotaState(uid) : null;

    await logAiInteraction(uid, "copilot", { sport, messageLen: msg.length });

    const legHint =
      maxPicks <= 5 && (m.includes("parlay") || m.includes("sgp") || /\d+\s*[- ]?leg/.test(m))
        ? "Parlay-style ask detected — cap a few legs and confirm correlation rules on your book."
        : "Widen max picks or lower min confidence if the grid comes back thin.";
    return res.json({
      sport,
      suggestedFilters: { minConfidence, maxPicks },
      coachingNotes: [
        `Try ${sport.toUpperCase()} with min confidence ~${minConfidence}% and up to ~${maxPicks} legs for the tone of your message.`,
        legHint,
        "Verify every leg on your sportsbook; prices here are indicative snapshots.",
        "Parlay math in-app is hypothetical stake × combined decimal odds (no tickets placed).",
      ],
      disclaimer:
        "Educational analytics only — not betting advice. Hit-A-Lick does not accept or place wagers.",
      aiQuota:
        access === "unlimited"
          ? { unlimited: true }
          : {
              unlimited: false,
              monthKey: afterMetered?.monthKey,
              used: afterMetered?.used,
              limit: afterMetered?.limit,
            },
    });
  } catch (error) {
    return res.status(500).json({ error: error.message || "Copilot failed." });
  }
});

router.post("/parlay", async (req, res) => {
  try {
    const v = await verifyUidToken(req);
    if (v.error) return res.status(v.error).json({ error: v.message });
    const { uid, email } = v;
    const access = await classifyAiAccess(uid, email);
    if (access === "deny_no_subscription") {
      return res.status(403).json({
        error: "Website subscription required for AI tools.",
        code: "NEEDS_APP_SUBSCRIPTION",
        upgradeUrl: process.env.APP_PRICING_URL || "https://hit-a-lick-database.web.app/pricing.html",
      });
    }
    if (access === "deny_quota") {
      return res.status(402).json({
        error: "AI quota exceeded. Upgrade to Premium for unlimited AI.",
        code: "AI_QUOTA_EXCEEDED",
        upgradeUrl: process.env.APP_PRICING_URL || "https://hit-a-lick-database.web.app/pricing.html",
      });
    }
    if (access === "metered") {
      try {
        await incrementMeteredAiQuota(uid);
      } catch (e) {
        if (e.code === "QUOTA_EXCEEDED" || e.message === "QUOTA_EXCEEDED") {
          return res.status(402).json({
            error: "AI quota exceeded.",
            code: "AI_QUOTA_EXCEEDED",
            upgradeUrl: process.env.APP_PRICING_URL || "https://hit-a-lick-database.web.app/pricing.html",
          });
        }
        throw e;
      }
    }

    const picks = Array.isArray(req.body?.picks) ? req.body.picks : [];
    const stake = Math.max(0, Number(req.body?.stake || 0));
    if (!picks.length) return res.status(400).json({ error: "Provide picks array." });

    let parlayDecimal = 1;
    const normalized = [];
    for (const pick of picks) {
      const raw = pick?.odds;
      const dec = rawOddsToDecimalPrice(raw);
      if (!dec) continue;
      parlayDecimal *= dec;
      const american = decimalPriceToAmerican(dec);
      normalized.push({
        label: String(pick.label || "Pick"),
        odds: american != null ? american : Number(raw),
        decimalOdds: Number(dec.toFixed(6)),
      });
    }

    if (!normalized.length) {
      return res.status(400).json({ error: "No valid odds in picks." });
    }

    const projectedReturn = stake > 0 ? Number((stake * parlayDecimal).toFixed(2)) : null;
    const projectedProfit = stake > 0 ? Number((projectedReturn - stake).toFixed(2)) : null;
    const combinedAmerican = decimalPriceToAmerican(parlayDecimal);

    return res.json({
      legCount: normalized.length,
      picks: normalized,
      parlayDecimal: Number(parlayDecimal.toFixed(6)),
      combinedAmerican: combinedAmerican != null ? combinedAmerican : null,
      stake: stake || null,
      projectedReturn,
      projectedProfit,
    });
  } catch (error) {
    return res.status(500).json({ error: error.message || "Failed to calculate parlay." });
  }
});

export { router };
