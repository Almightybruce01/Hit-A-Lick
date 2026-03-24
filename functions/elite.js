import express from "express";
import admin from "firebase-admin";
import { mergeStaffEntitlement } from "./billing.js";
import {
  TIER_RANK,
  normalizeTier,
  featureFlagsForTier,
  evaluateUserAlerts,
  updateOutcomeModel,
  rankingProfileFromDoc,
} from "./eliteEngine.js";

const router = express.Router();
const OWNER_EMAIL = (process.env.OWNER_EMAIL || "brucebrian50@gmail.com").toLowerCase();

async function requireAuth(req, res, next) {
  try {
    const authHeader = req.headers.authorization || "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
    const uid = String(req.body?.uid || req.query?.uid || "").trim();
    if (!token || !uid) {
      return res.status(401).json({ error: "Auth token and uid are required." });
    }

    const decoded = await admin.auth().verifyIdToken(token);
    if (decoded.uid !== uid) {
      return res.status(403).json({ error: "Token uid mismatch." });
    }

    let tier = "core";
    const email = (decoded.email || "").toLowerCase();
    if (email === OWNER_EMAIL) {
      tier = "elite";
    } else {
      const userSnap = await admin.firestore().collection("users").doc(uid).get();
      const rawEnt = userSnap.exists ? userSnap.data()?.entitlement || {} : {};
      const entitlement = mergeStaffEntitlement({ ...rawEnt }, email);
      const active = entitlement.active === true;
      const rawTier = normalizeTier(entitlement.tier || "core");
      tier = active ? rawTier : "core";
    }

    req.viewer = {
      uid,
      email: decoded.email || "",
      tier,
      rank: TIER_RANK[tier] || 1,
    };
    return next();
  } catch (error) {
    return res.status(401).json({ error: "Invalid auth token." });
  }
}

async function readUserDoc(uid) {
  const ref = admin.firestore().collection("eliteUsers").doc(uid);
  const snap = await ref.get();
  const data = snap.exists ? snap.data() : {};
  return {
    ref,
    data,
  };
}

router.get("/bootstrap", requireAuth, async (req, res) => {
  try {
    const { uid, tier } = req.viewer;
    const { data } = await readUserDoc(uid);
    return res.json({
      ok: true,
      uid,
      tier,
      features: featureFlagsForTier(tier),
      strategyProfile: data.strategyProfile || "balanced",
      interests: Array.isArray(data.interests) ? data.interests : [],
      presets: Array.isArray(data.presets) ? data.presets : [],
      boards: Array.isArray(data.boards) ? data.boards : [],
      alertPrefs: data.alertPrefs || {
        minEdgePct: 2.5,
        minConfidence: 58,
        minVelocity: 18,
        steamOnly: false,
      },
      updatedAt: data.updatedAt || null,
      rankingProfile: rankingProfileFromDoc(data),
    });
  } catch (error) {
    return res.status(500).json({ error: error.message || "Failed to load bootstrap." });
  }
});

router.post("/state/save", requireAuth, async (req, res) => {
  try {
    const { uid } = req.viewer;
    const body = req.body || {};
    const patch = {
      strategyProfile: String(body.strategyProfile || "balanced"),
      interests: Array.isArray(body.interests)
        ? body.interests.map((x) => String(x).toLowerCase()).slice(0, 24)
        : [],
      presets: Array.isArray(body.presets) ? body.presets.slice(0, 30) : [],
      boards: Array.isArray(body.boards) ? body.boards.slice(0, 30) : [],
      alertPrefs: body.alertPrefs || null,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    };
    await admin.firestore().collection("eliteUsers").doc(uid).set(patch, { merge: true });
    return res.json({ ok: true });
  } catch (error) {
    return res.status(500).json({ error: error.message || "Failed to save state." });
  }
});

router.post("/session-feedback", requireAuth, async (req, res) => {
  try {
    const { uid } = req.viewer;
    const body = req.body || {};
    await admin.firestore().collection("eliteUsers").doc(uid).collection("sessions").add({
      ts: admin.firestore.FieldValue.serverTimestamp(),
      surface: String(body.surface || "web"),
      openedMatchups: Number(body.openedMatchups || 0),
      addedPicks: Number(body.addedPicks || 0),
      savedBoards: Number(body.savedBoards || 0),
      topMarket: String(body.topMarket || "all"),
      strategyProfile: String(body.strategyProfile || "balanced"),
      notes: String(body.notes || "").slice(0, 500),
      pickHoldMinutes: Number(body.pickHoldMinutes || 0),
      didWin: body.didWin === true,
      closeLineDelta: Number(body.closeLineDelta || 0),
    });
    return res.json({ ok: true });
  } catch (error) {
    return res.status(500).json({ error: error.message || "Failed to save session feedback." });
  }
});

router.post("/alerts/evaluate", requireAuth, async (req, res) => {
  try {
    const { uid, tier, rank } = req.viewer;
    if (rank < 2) return res.status(403).json({ error: "Pro tier required." });

    const sport = String(req.body?.sport || "all").toLowerCase();
    const minEdgePct = Number(req.body?.minEdgePct || 2.5);
    const minConfidence = Number(req.body?.minConfidence || 58);
    const minVelocity = Number(req.body?.minVelocity || 18);
    const steamOnly = Boolean(req.body?.steamOnly || false);
    const result = await evaluateUserAlerts({
      uid,
      tier,
      sport,
      filters: { minEdgePct, minConfidence, minVelocity, steamOnly },
      triggeredBy: "manual",
    });
    return res.json({
      ok: true,
      count: result.count,
      queued: result.queued,
      dedupedByCooldown: result.deduped,
      items: result.items,
    });
  } catch (error) {
    return res.status(500).json({ error: error.message || "Failed to evaluate alerts." });
  }
});

router.get("/alerts/feed", requireAuth, async (req, res) => {
  try {
    const { uid, rank } = req.viewer;
    if (rank < 2) return res.status(403).json({ error: "Pro tier required." });
    const snap = await admin
      .firestore()
      .collection("eliteUsers")
      .doc(uid)
      .collection("alerts")
      .orderBy("createdAt", "desc")
      .limit(12)
      .get();
    const feeds = snap.docs.map((d) => d.data() || {});
    const items = feeds.flatMap((x) => (Array.isArray(x.items) ? x.items : [])).slice(0, 120);
    return res.json({ ok: true, count: items.length, items });
  } catch (error) {
    return res.status(500).json({ error: error.message || "Failed to load alert feed." });
  }
});

router.post("/devices/register", requireAuth, async (req, res) => {
  try {
    const { uid, rank } = req.viewer;
    if (rank < 2) return res.status(403).json({ error: "Pro tier required." });
    const token = String(req.body?.token || "").trim();
    const provider = String(req.body?.provider || "fcm").toLowerCase();
    const platform = String(req.body?.platform || "ios").toLowerCase();
    if (!token) return res.status(400).json({ error: "Device token is required." });
    const id = token.replace(/[^a-zA-Z0-9_.-]+/g, "_").slice(0, 220);
    await admin
      .firestore()
      .collection("eliteUsers")
      .doc(uid)
      .collection("devices")
      .doc(id)
      .set(
        {
          token,
          provider,
          platform,
          enabled: true,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
    return res.json({ ok: true, provider, platform });
  } catch (error) {
    return res.status(500).json({ error: error.message || "Failed to register device." });
  }
});

router.post("/devices/unregister", requireAuth, async (req, res) => {
  try {
    const { uid } = req.viewer;
    const token = String(req.body?.token || "").trim();
    if (!token) return res.status(400).json({ error: "Device token is required." });
    const id = token.replace(/[^a-zA-Z0-9_.-]+/g, "_").slice(0, 220);
    await admin
      .firestore()
      .collection("eliteUsers")
      .doc(uid)
      .collection("devices")
      .doc(id)
      .set({ enabled: false, updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
    return res.json({ ok: true });
  } catch (error) {
    return res.status(500).json({ error: error.message || "Failed to unregister device." });
  }
});

router.post("/session-outcome", requireAuth, async (req, res) => {
  try {
    const { uid, rank } = req.viewer;
    if (rank < 2) return res.status(403).json({ error: "Pro tier required." });
    const payload = {
      didWin: req.body?.didWin === true,
      closeLineDelta: Number(req.body?.closeLineDelta || 0),
      pickHoldMinutes: Number(req.body?.pickHoldMinutes || 0),
      edgeAtPick: Number(req.body?.edgeAtPick || 0),
      ts: admin.firestore.FieldValue.serverTimestamp(),
    };
    await admin.firestore().collection("eliteUsers").doc(uid).collection("outcomes").add(payload);
    await updateOutcomeModel(uid, payload);
    return res.json({ ok: true });
  } catch (error) {
    return res.status(500).json({ error: error.message || "Failed to record session outcome." });
  }
});

router.get("/ranking/profile", requireAuth, async (req, res) => {
  try {
    const { uid, rank } = req.viewer;
    if (rank < 2) return res.status(403).json({ error: "Pro tier required." });
    const snap = await admin.firestore().collection("eliteUsers").doc(uid).get();
    const data = snap.exists ? snap.data() : {};
    return res.json({ ok: true, profile: rankingProfileFromDoc(data || {}) });
  } catch (error) {
    return res.status(500).json({ error: error.message || "Failed to load ranking profile." });
  }
});

router.get("/clv/history", requireAuth, async (req, res) => {
  try {
    const { rank } = req.viewer;
    if (rank < 3) return res.status(403).json({ error: "Elite tier required." });
    const sport = String(req.query.sport || "").toLowerCase();
    const matchup = String(req.query.matchup || "");
    const market = String(req.query.market || "");
    const side = String(req.query.side || "");
    const line = String(req.query.line ?? "na");
    const limit = Math.max(4, Math.min(80, Number(req.query.limit || 24)));
    if (!sport || !matchup || !market) {
      return res.status(400).json({ error: "sport, matchup, and market are required." });
    }
    const key = `${sport}_${matchup}_${market}_${side}_${line}`.replace(/[^a-zA-Z0-9_.-]+/g, "_").slice(0, 220);
    const snap = await admin
      .firestore()
      .collection("propClvTimeline")
      .doc(key)
      .collection("points")
      .orderBy("sampledAt", "desc")
      .limit(limit)
      .get();
    const points = snap.docs.map((d) => d.data() || {}).reverse();
    return res.json({ ok: true, key, count: points.length, points });
  } catch (error) {
    return res.status(500).json({ error: error.message || "Failed to load CLV history." });
  }
});

router.post("/clv/history/batch", requireAuth, async (req, res) => {
  try {
    const { rank } = req.viewer;
    if (rank < 3) return res.status(403).json({ error: "Elite tier required." });
    const rows = Array.isArray(req.body?.rows) ? req.body.rows.slice(0, 14) : [];
    const limit = Math.max(4, Math.min(40, Number(req.body?.limit || 16)));
    const results = {};
    for (const row of rows) {
      const sport = String(row?.sport || "").toLowerCase();
      const matchup = String(row?.matchup || "");
      const market = String(row?.market || "");
      const side = String(row?.side || "");
      const line = String(row?.line ?? "na");
      if (!sport || !matchup || !market) continue;
      const key = `${sport}_${matchup}_${market}_${side}_${line}`.replace(/[^a-zA-Z0-9_.-]+/g, "_").slice(0, 220);
      const snap = await admin
        .firestore()
        .collection("propClvTimeline")
        .doc(key)
        .collection("points")
        .orderBy("sampledAt", "desc")
        .limit(limit)
        .get();
      const points = snap.docs.map((d) => d.data() || {}).reverse();
      results[key] = points.map((p) => ({
        edgePct: Number(p.edgePct || 0),
        bestOdds: Number(p.bestOdds || 0),
        fairOdds: Number(p.fairOdds || 0),
        sampledAtIso: p.sampledAtIso || null,
      }));
    }
    return res.json({ ok: true, timelines: results });
  } catch (error) {
    return res.status(500).json({ error: error.message || "Failed to load CLV timelines." });
  }
});

export { router };

