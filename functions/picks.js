import express from "express";
import admin from "firebase-admin";
import { mergeStaffEntitlement, hydrateEntitlementForApi } from "./billing.js";

const router = express.Router();
const OWNER_EMAIL = (process.env.OWNER_EMAIL || "brucebrian50@gmail.com").toLowerCase();
const GIAP_EMAIL = String(process.env.CURATOR_GIAP_EMAIL || "giap.social1@gmail.com")
  .trim()
  .toLowerCase();

const PICKS_DOCS = {
  bruce: "bruce_picks",
  premium: "bruce_premium_picks",
  giap: "giap_picks",
  currentBets: "current_bets",
};

/** Bruce JSON boards require **Bruce** curator sub; Giap board requires **Giap** sub (separate Stripe products). */
function hasPicksFeedAccess(routeTier, entitlement = {}) {
  const t = String(routeTier || "").toLowerCase();
  const ids = Array.isArray(entitlement.curatorIds)
    ? entitlement.curatorIds.map((x) => String(x).toLowerCase())
    : [];
  if (t === "bruce" || t === "premium") return ids.includes("bruce");
  if (t === "giap") return ids.includes("giap");
  return false;
}

function normalizeItem(item = {}) {
  const wagerTypeRaw = String(item.wagerType || item.type || "").toLowerCase();
  const wagerType = wagerTypeRaw === "parlay" ? "parlay" : "single";
  const resultRaw = String(item.result || "").toLowerCase();
  const result = ["win", "loss", "push", "pending"].includes(resultRaw) ? resultRaw : "pending";
  return {
    title: String(item.title || "").trim(),
    league: String(item.league || "").trim(),
    pick: String(item.pick || "").trim(),
    notes: String(item.notes || "").trim(),
    confidence: Number(item.confidence || 0),
    gameDate: String(item.gameDate || "").trim(),
    wagerType,
    result,
  };
}

async function requireOwner(req, res, next) {
  try {
    const authHeader = req.headers.authorization || "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
    if (!token) {
      return res.status(401).json({ error: "Missing bearer token." });
    }

    const decoded = await admin.auth().verifyIdToken(token);
    if (!decoded.email || decoded.email.toLowerCase() !== OWNER_EMAIL) {
      return res.status(403).json({ error: "Owner access required." });
    }

    req.ownerUid = decoded.uid;
    req.ownerEmail = decoded.email;
    return next();
  } catch (error) {
    return res.status(401).json({ error: "Invalid auth token." });
  }
}

async function requirePickEditor(req, res, next) {
  try {
    const authHeader = req.headers.authorization || "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
    const tier = String(req.params.tier || "").toLowerCase();
    if (!token) {
      return res.status(401).json({ error: "Missing bearer token." });
    }
    const decoded = await admin.auth().verifyIdToken(token);
    const email = (decoded.email || "").toLowerCase();
    if (email === OWNER_EMAIL) {
      req.ownerUid = decoded.uid;
      req.ownerEmail = decoded.email;
      return next();
    }
    if (tier === "giap" && GIAP_EMAIL && email === GIAP_EMAIL) {
      req.ownerUid = decoded.uid;
      req.ownerEmail = decoded.email;
      return next();
    }
    return res.status(403).json({ error: "Curator or owner access required." });
  } catch (error) {
    return res.status(401).json({ error: "Invalid auth token." });
  }
}

async function requireSubscriber(req, res, next) {
  try {
    const authHeader = req.headers.authorization || "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
    const uid = String(req.query.uid || "").trim();
    const tier = String(req.params.tier || "").toLowerCase();

    if (!token || !uid) {
      return res.status(401).json({ error: "Auth token and uid are required." });
    }

    const decoded = await admin.auth().verifyIdToken(token);
    if (decoded.uid !== uid) {
      return res.status(403).json({ error: "Token uid mismatch." });
    }

    const viewerEmail = decoded.email ? decoded.email.toLowerCase() : "";
    if (viewerEmail === OWNER_EMAIL || (GIAP_EMAIL && viewerEmail === GIAP_EMAIL)) {
      req.viewerUid = decoded.uid;
      req.viewerEmail = decoded.email;
      return next();
    }

    const userSnap = await admin.firestore().collection("users").doc(uid).get();
    const rawEnt = userSnap.exists ? userSnap.data()?.entitlement || {} : {};
    const entitlement = hydrateEntitlementForApi(mergeStaffEntitlement({ ...rawEnt }, viewerEmail));

    if (!entitlement.hasAppAccess) {
      return res.status(403).json({
        error: "Subscribe to Regular or Premium (AI) on the website before curator pick feeds.",
        code: "NEEDS_APP_ACCESS",
        upgradeUrl: process.env.APP_PRICING_URL || "https://hit-a-lick-database.web.app/pricing.html",
      });
    }

    if (!hasPicksFeedAccess(tier, entitlement)) {
      const need = tier === "giap" ? "Giap picks" : "Bruce picks";
      return res.status(403).json({
        error: `${need} subscription required (separate add-on on the website).`,
        code: "NEEDS_CURATOR_SUBSCRIPTION",
        tier,
      });
    }

    req.viewerUid = decoded.uid;
    req.viewerEmail = decoded.email || "";
    return next();
  } catch (error) {
    return res.status(401).json({ error: "Invalid auth token." });
  }
}

router.get("/current-bets/list", requireOwner, async (req, res) => {
  try {
    const snap = await admin
      .firestore()
      .collection("contentPicks")
      .doc(PICKS_DOCS.currentBets)
      .get();
    const data = snap.exists ? snap.data() : {};
    return res.json({
      headline: data.headline || "Current Bets Board",
      items: Array.isArray(data.items) ? data.items : [],
      updatedAt: data.updatedAt || null,
      updatedBy: data.updatedBy || null,
    });
  } catch (error) {
    return res.status(500).json({ error: error.message || "Failed to load current bets." });
  }
});

router.post("/current-bets/save", requireOwner, async (req, res) => {
  try {
    const body = req.body || {};
    const items = Array.isArray(body.items) ? body.items.map(normalizeItem) : [];
    const payload = {
      headline: String(body.headline || "Current Bets Board").trim(),
      items,
      updatedBy: req.ownerEmail,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    };

    await admin
      .firestore()
      .collection("contentPicks")
      .doc(PICKS_DOCS.currentBets)
      .set(payload, { merge: true });

    return res.json({ ok: true, count: items.length });
  } catch (error) {
    return res.status(500).json({ error: error.message || "Failed to save current bets." });
  }
});

const FEED_DOC_BY_ROUTE = {
  bruce: PICKS_DOCS.bruce,
  premium: PICKS_DOCS.premium,
  giap: PICKS_DOCS.giap,
};

router.get("/:tier", requireSubscriber, async (req, res) => {
  try {
    const tier = String(req.params.tier || "").toLowerCase();
    const docKey = FEED_DOC_BY_ROUTE[tier];
    if (!docKey) {
      return res.status(404).json({ error: "Unknown picks feed." });
    }
    const snap = await admin.firestore().collection("contentPicks").doc(docKey).get();
    const data = snap.exists ? snap.data() : {};
    const items = Array.isArray(data.items) ? data.items.map(normalizeItem) : [];
    const makeStats = (subset) => {
      const rows = subset.filter((x) => x.result === "win" || x.result === "loss" || x.result === "push");
      const wins = rows.filter((x) => x.result === "win").length;
      const losses = rows.filter((x) => x.result === "loss").length;
      const pushes = rows.filter((x) => x.result === "push").length;
      const settled = wins + losses + pushes;
      const denom = wins + losses;
      return {
        picks: subset.length,
        settled,
        wins,
        losses,
        pushes,
        winPct: denom > 0 ? Number(((100 * wins) / denom).toFixed(1)) : null,
      };
    };
    const singleItems = items.filter((x) => x.wagerType !== "parlay");
    const parlayItems = items.filter((x) => x.wagerType === "parlay");
    return res.json({
      tier,
      headline: data.headline || "",
      hitRateClaim: data.hitRateClaim || "90%",
      items,
      stats: {
        overall: makeStats(items),
        singles: makeStats(singleItems),
        parlays: makeStats(parlayItems),
      },
    });
  } catch (error) {
    return res.status(500).json({ error: error.message || "Failed to load picks." });
  }
});

router.post("/:tier", requirePickEditor, async (req, res) => {
  try {
    const tier = String(req.params.tier || "").toLowerCase();
    const docKey = FEED_DOC_BY_ROUTE[tier];
    if (!docKey) {
      return res.status(404).json({ error: "Unknown picks feed." });
    }
    const body = req.body || {};
    const items = Array.isArray(body.items) ? body.items.map(normalizeItem) : [];
    const payload = {
      headline: String(body.headline || "").trim(),
      hitRateClaim: String(body.hitRateClaim || "90%").trim(),
      items,
      updatedBy: req.ownerEmail || "",
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    };
    await admin.firestore().collection("contentPicks").doc(docKey).set(payload, { merge: true });
    return res.json({ ok: true, count: items.length });
  } catch (error) {
    return res.status(500).json({ error: error.message || "Failed to save picks." });
  }
});

export { router };
