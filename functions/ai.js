import express from "express";
import admin from "firebase-admin";

const router = express.Router();

const OWNER_EMAIL = (process.env.OWNER_EMAIL || "brucebrian50@gmail.com").toLowerCase();
const GIAP_EMAIL = String(process.env.CURATOR_GIAP_EMAIL || "giap.social1@gmail.com")
  .trim()
  .toLowerCase();

const FREE_AI_REQUESTS_MONTHLY = 5;

function americanToDecimal(americanOdds) {
  const n = Number(americanOdds);
  if (!Number.isFinite(n) || n === 0) return null;
  if (n > 0) return 1 + n / 100;
  return 1 + 100 / Math.abs(n);
}

function impliedProbabilityFromAmerican(americanOdds) {
  const n = Number(americanOdds);
  if (!Number.isFinite(n) || n === 0) return null;
  if (n > 0) return 100 / (n + 100);
  return Math.abs(n) / (Math.abs(n) + 100);
}

function subscriptionGrantsUnlimitedAi(entitlement = {}) {
  if (entitlement.active !== true) return false;
  const tier = String(entitlement.tier || "core").toLowerCase();
  if (tier === "premium" || entitlement.curatorAllAccess === true) return true;
  if (tier === "bruce" || tier.startsWith("curator_")) return true;
  const ids = Array.isArray(entitlement.curatorIds) ? entitlement.curatorIds : [];
  return ids.length > 0;
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
  if (email === OWNER_EMAIL || (GIAP_EMAIL && email === GIAP_EMAIL)) return "unlimited";

  const userSnap = await admin.firestore().collection("users").doc(uid).get();
  const entitlement = userSnap.exists ? userSnap.data()?.entitlement || {} : {};
  if (subscriptionGrantsUnlimitedAi(entitlement)) return "subscription";

  const { used, limit } = await readAiQuotaState(uid);
  if (used >= limit) return "deny";
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

    if (email === OWNER_EMAIL || (GIAP_EMAIL && email === GIAP_EMAIL)) {
      return res.json({
        unlimited: true,
        freeMonthly: FREE_AI_REQUESTS_MONTHLY,
        staff: email === OWNER_EMAIL ? "owner" : "giap",
      });
    }

    const userSnap = await admin.firestore().collection("users").doc(uid).get();
    const entitlement = userSnap.exists ? userSnap.data()?.entitlement || {} : {};
    if (subscriptionGrantsUnlimitedAi(entitlement)) {
      return res.json({ unlimited: true, freeMonthly: FREE_AI_REQUESTS_MONTHLY });
    }

    const { monthKey, used, limit } = await readAiQuotaState(uid);
    return res.json({
      unlimited: false,
      monthKey,
      used,
      limit,
      remaining: Math.max(0, limit - used),
      freeMonthly: FREE_AI_REQUESTS_MONTHLY,
    });
  } catch (e) {
    res.status(401).json({ error: e.message || "Invalid auth token." });
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

  return candidates;
}

router.post("/picks", async (req, res) => {
  try {
    const v = await verifyUidToken(req);
    if (v.error) return res.status(v.error).json({ error: v.message });
    const { uid, email } = v;

    const access = await classifyAiAccess(uid, email);
    if (access === "deny") {
      const { monthKey, used, limit } = await readAiQuotaState(uid);
      return res.status(402).json({
        error: "Monthly AI request limit reached.",
        freeMonthly: FREE_AI_REQUESTS_MONTHLY,
        used,
        limit,
        monthKey,
        hint: "Subscribe for unlimited AI picks, or buy credit packs when available in billing.",
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
        access === "unlimited" || access === "subscription"
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
    if (access === "deny") {
      const { monthKey, used, limit } = await readAiQuotaState(uid);
      return res.status(402).json({
        error: "Monthly AI request limit reached.",
        freeMonthly: FREE_AI_REQUESTS_MONTHLY,
        used,
        limit,
        monthKey,
      });
    }

    const msg = String(req.body?.message || "").slice(0, 2000);
    const sport = String(req.body?.sport || "nba").toLowerCase();
    let minConfidence = 58;
    let maxPicks = 7;
    const m = msg.toLowerCase();
    if (m.includes("aggressive") || m.includes("longshot") || m.includes("chase")) minConfidence = 48;
    if (m.includes("safe") || m.includes("conservative") || m.includes("bank")) minConfidence = 68;
    if (m.includes("few") || m.includes("one") || m.includes("two leg")) maxPicks = 3;
    if (m.includes("deep") || m.includes("full slate") || m.includes("lotto")) maxPicks = 14;

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

    return res.json({
      sport,
      suggestedFilters: { minConfidence, maxPicks },
      coachingNotes: [
        `Try ${sport.toUpperCase()} with min confidence ~${minConfidence}% for the tone of your message.`,
        "Verify every leg on your sportsbook; prices here are indicative snapshots.",
        "Parlay math in-app is hypothetical stake × combined decimal odds (no tickets placed).",
      ],
      disclaimer:
        "Educational analytics only — not betting advice. Hit-A-Lick does not accept or place wagers.",
      aiQuota:
        access === "unlimited" || access === "subscription"
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

    const picks = Array.isArray(req.body?.picks) ? req.body.picks : [];
    const stake = Math.max(0, Number(req.body?.stake || 0));
    if (!picks.length) return res.status(400).json({ error: "Provide picks array." });

    let parlayDecimal = 1;
    const normalized = [];
    for (const pick of picks) {
      const odds = Number(pick.odds);
      const dec = americanToDecimal(odds);
      if (!dec) continue;
      parlayDecimal *= dec;
      normalized.push({
        label: String(pick.label || "Pick"),
        odds,
        decimalOdds: dec,
      });
    }

    if (!normalized.length) {
      return res.status(400).json({ error: "No valid odds in picks." });
    }

    const projectedReturn = stake > 0 ? Number((stake * parlayDecimal).toFixed(2)) : null;
    const projectedProfit = stake > 0 ? Number((projectedReturn - stake).toFixed(2)) : null;

    return res.json({
      legCount: normalized.length,
      picks: normalized,
      parlayDecimal: Number(parlayDecimal.toFixed(4)),
      stake: stake || null,
      projectedReturn,
      projectedProfit,
    });
  } catch (error) {
    return res.status(500).json({ error: error.message || "Failed to calculate parlay." });
  }
});

export { router };
