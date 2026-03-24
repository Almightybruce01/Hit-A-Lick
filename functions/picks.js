import express from "express";
import admin from "firebase-admin";

const router = express.Router();
const OWNER_EMAIL = (process.env.OWNER_EMAIL || "brucebrian50@gmail.com").toLowerCase();

const PICKS_DOCS = {
  bruce: "bruce_picks",
  premium: "bruce_premium_picks",
  currentBets: "current_bets",
};

const ACCESS_RANK = {
  core: 1,
  bruce: 2,
  premium: 3,
};

function requiredRankForTier(tier) {
  if (tier === "bruce") return ACCESS_RANK.bruce;
  if (tier === "premium") return ACCESS_RANK.premium;
  return ACCESS_RANK.core;
}

/** Stripe-backed curator passes + legacy Bruce/Premium tiers (see billing.js). */
function hasLegacyPicksAccess(tier, entitlement = {}) {
  const t = String(tier || "").toLowerCase();
  const active = entitlement.active === true;
  if (!active) return false;
  const userTier = String(entitlement.tier || "core").toLowerCase();
  if (userTier === "premium" || entitlement.curatorAllAccess === true) {
    return true;
  }
  const ids = Array.isArray(entitlement.curatorIds) ? entitlement.curatorIds : [];
  if (ids.map((x) => String(x).toLowerCase()).includes("bruce") && t === "bruce") {
    return true;
  }
  const userRank = ACCESS_RANK[userTier] || 0;
  return userRank >= requiredRankForTier(t);
}

function normalizeItem(item = {}) {
  return {
    title: String(item.title || "").trim(),
    league: String(item.league || "").trim(),
    pick: String(item.pick || "").trim(),
    notes: String(item.notes || "").trim(),
    confidence: Number(item.confidence || 0),
    gameDate: String(item.gameDate || "").trim(),
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

    if (decoded.email && decoded.email.toLowerCase() === OWNER_EMAIL) {
      req.viewerUid = decoded.uid;
      req.viewerEmail = decoded.email;
      return next();
    }

    const userSnap = await admin.firestore().collection("users").doc(uid).get();
    const entitlement = userSnap.exists ? userSnap.data()?.entitlement || {} : {};

    if (entitlement.active !== true) {
      return res.status(402).json({ error: "Active paid membership required." });
    }

    if (!hasLegacyPicksAccess(tier, entitlement)) {
      return res.status(403).json({ error: "Membership tier upgrade required." });
    }

    req.viewerUid = decoded.uid;
    req.viewerEmail = decoded.email || "";
    return next();
  } catch (error) {
    return res.status(401).json({ error: "Invalid auth token." });
  }
}

router.get("/:tier", requireSubscriber, async (req, res) => {
  try {
    const tier = String(req.params.tier || "").toLowerCase();
    const docId = PICKS_DOCS[tier];
    if (!docId) return res.status(400).json({ error: "Invalid picks tier." });

    const snap = await admin.firestore().collection("contentPicks").doc(docId).get();
    const data = snap.exists ? snap.data() : {};

    return res.json({
      tier,
      headline: data.headline || "",
      hitRateClaim: data.hitRateClaim || "90%",
      items: Array.isArray(data.items) ? data.items : [],
      updatedAt: data.updatedAt || null,
      updatedBy: data.updatedBy || null,
    });
  } catch (error) {
    return res.status(500).json({ error: error.message || "Failed to load picks." });
  }
});

router.post("/:tier", requireOwner, async (req, res) => {
  try {
    const tier = String(req.params.tier || "").toLowerCase();
    const docId = PICKS_DOCS[tier];
    if (!docId) return res.status(400).json({ error: "Invalid picks tier." });

    const body = req.body || {};
    const items = Array.isArray(body.items) ? body.items.map(normalizeItem) : [];
    if (!items.length) return res.status(400).json({ error: "Provide at least one pick item." });

    const payload = {
      headline: String(body.headline || "").trim(),
      hitRateClaim: String(body.hitRateClaim || "90%").trim(),
      items,
      updatedBy: req.ownerEmail,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    };

    await admin.firestore().collection("contentPicks").doc(docId).set(payload, { merge: true });
    return res.json({ ok: true, tier, count: items.length });
  } catch (error) {
    return res.status(500).json({ error: error.message || "Failed to save picks." });
  }
});

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

export { router };
