import admin from "firebase-admin";

const TIER_RANK = { core: 1, pro: 2, elite: 3, bruce: 2, premium: 3 };
const ALERT_COOLDOWN_MS = Number(process.env.ALERT_COOLDOWN_MS || 45 * 60 * 1000);

function normalizeTier(tier = "core") {
  const t = String(tier || "core").toLowerCase();
  if (t === "premium") return "elite";
  if (t === "bruce") return "pro";
  return ["core", "pro", "elite"].includes(t) ? t : "core";
}

function featureFlagsForTier(tier) {
  const rank = TIER_RANK[tier] || 1;
  return {
    chartsStack: rank >= 2,
    alertGraph: rank >= 2,
    saveBoards: rank >= 2,
    pickStudio: rank >= 3,
    shareSlips: rank >= 3,
    clvTimeline: rank >= 3,
    pushAlerts: rank >= 2,
  };
}

function alertKeyFromParts(parts) {
  return String(parts.join("|"))
    .toLowerCase()
    .replace(/[^a-z0-9_|.-]+/g, "_")
    .slice(0, 240);
}

function rankToRiskBand(rankScore = 0) {
  const n = Number(rankScore || 0);
  if (n >= 74) return "aggressive";
  if (n >= 60) return "balanced";
  return "safe";
}

function computeBehaviorBoost(modelV2 = {}) {
  const winRate = Number(modelV2.winRate || 0.5);
  const avgClv = Number(modelV2.avgCloseLineDelta || 0);
  const avgHold = Number(modelV2.avgHoldMinutes || 30);
  const winComp = Math.max(0, Math.min(1, winRate));
  const clvComp = Math.max(0, Math.min(1, (avgClv + 6) / 12));
  const holdComp = Math.max(0, Math.min(1, 1 - Math.abs(avgHold - 35) / 70));
  return Number((winComp * 0.55 + clvComp * 0.3 + holdComp * 0.15).toFixed(3));
}

function buildCandidateAlertsFromProps(props = [], filters = {}) {
  const minEdgePct = Number(filters.minEdgePct ?? 2.5);
  const minConfidence = Number(filters.minConfidence ?? 58);
  const minVelocity = Number(filters.minVelocity ?? 18);
  const steamOnly = Boolean(filters.steamOnly || false);
  const nowIso = new Date().toISOString();
  const alerts = [];
  for (const p of props) {
    const confidence = Number(p.confidence || 0);
    const velocity = Number(p?.analytics?.microstructure?.velocity || 0);
    const steam = Boolean(p?.analytics?.steamFlag);
    const topEdge = (p?.analytics?.topEdges || [])[0] || null;
    const edgePct = Number(topEdge?.edgePct || 0);

    if (confidence < minConfidence) continue;
    if (velocity < minVelocity) continue;
    if (edgePct < minEdgePct) continue;
    if (steamOnly && !steam) continue;

    alerts.push({
      sport: p.sport || "nba",
      matchup: p.matchup || "",
      confidence,
      confidenceBand: p.confidenceBand || "yellow",
      velocity,
      steamFlag: steam,
      edgePct,
      topEdge: topEdge
        ? {
            label: topEdge.label || null,
            market: topEdge.market || null,
            side: topEdge.side || null,
            line: topEdge.line ?? null,
            bestOdds: topEdge.bestOdds ?? null,
            bestBook: topEdge.bestBook || null,
            fairOdds: topEdge.fairOdds ?? null,
          }
        : null,
      source: p.source || null,
      ts: nowIso,
    });
  }
  return alerts;
}

async function evaluateUserAlerts({
  uid,
  tier = "core",
  sport = "all",
  filters = {},
  triggeredBy = "manual",
  maxProps = 600,
  maxAlerts = 120,
}) {
  const normalizedTier = normalizeTier(tier);
  if ((TIER_RANK[normalizedTier] || 1) < 2) {
    return { count: 0, queued: 0, deduped: 0, items: [] };
  }

  let query = admin.firestore().collection("props").limit(maxProps);
  if (sport !== "all") query = query.where("sport", "==", sport);
  const snap = await query.get();
  const props = snap.docs.map((doc) => doc.data() || {});
  const candidates = buildCandidateAlertsFromProps(props, filters).slice(0, maxAlerts);

  const deduped = [];
  let queued = 0;
  let dedupeHits = 0;
  for (const alert of candidates) {
    const edge = alert.topEdge || {};
    const key = alertKeyFromParts([
      alert.sport,
      alert.matchup,
      edge.market || "market",
      edge.side || "side",
      edge.line ?? "na",
      edge.bestBook || "book",
    ]);
    const coolRef = admin
      .firestore()
      .collection("eliteUsers")
      .doc(uid)
      .collection("alertCooldown")
      .doc(key);
    const coolSnap = await coolRef.get();
    const lastTs = coolSnap.exists ? coolSnap.data()?.lastTriggeredAt : null;
    const lastMs =
      lastTs && typeof lastTs.toMillis === "function" ? lastTs.toMillis() : Number(lastTs || 0);
    if (lastMs && Date.now() - lastMs < ALERT_COOLDOWN_MS) {
      dedupeHits += 1;
      continue;
    }

    await coolRef.set(
      {
        key,
        alert,
        lastTriggeredAt: admin.firestore.FieldValue.serverTimestamp(),
        cooldownMs: ALERT_COOLDOWN_MS,
      },
      { merge: true }
    );

    const alertId = `${key}-${Date.now()}`;
    deduped.push({ id: alertId, key, ...alert });

    await admin.firestore().collection("notificationQueue").add({
      uid,
      status: "pending",
      provider: "fcm",
      channel: "push",
      key,
      tier: normalizedTier,
      title: `${alert.sport?.toUpperCase()} Edge Alert`,
      body: `${alert.matchup} • ${Number(alert.edgePct || 0).toFixed(1)}% edge • ${Number(alert.confidence || 0)}% confidence`,
      payload: {
        type: "edge_alert",
        sport: alert.sport || "nba",
        matchup: alert.matchup || "",
        edgePct: Number(alert.edgePct || 0),
        confidence: Number(alert.confidence || 0),
        confidenceBand: alert.confidenceBand || "yellow",
        steamFlag: Boolean(alert.steamFlag),
        topEdge: alert.topEdge || null,
      },
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      triggeredBy,
    });
    queued += 1;
  }

  await admin.firestore().collection("eliteUsers").doc(uid).collection("alerts").add({
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    tier: normalizedTier,
    sport,
    filters,
    dedupeHits,
    triggeredBy,
    count: deduped.length,
    items: deduped.slice(0, 80),
  });

  return {
    count: deduped.length,
    queued,
    deduped: dedupeHits,
    items: deduped.slice(0, 80),
  };
}

async function dispatchPendingNotifications(limit = 120) {
  const queueSnap = await admin
    .firestore()
    .collection("notificationQueue")
    .where("status", "==", "pending")
    .limit(limit)
    .get();
  if (queueSnap.empty) return { scanned: 0, sent: 0, failed: 0 };

  let sent = 0;
  let failed = 0;
  for (const qDoc of queueSnap.docs) {
    const q = qDoc.data() || {};
    const uid = String(q.uid || "");
    if (!uid) {
      await qDoc.ref.set(
        { status: "failed", error: "missing_uid", processedAt: admin.firestore.FieldValue.serverTimestamp() },
        { merge: true }
      );
      failed += 1;
      continue;
    }

    const deviceSnap = await admin
      .firestore()
      .collection("eliteUsers")
      .doc(uid)
      .collection("devices")
      .where("enabled", "==", true)
      .where("provider", "==", "fcm")
      .limit(20)
      .get();
    const tokens = deviceSnap.docs.map((d) => String(d.data()?.token || "")).filter(Boolean);

    if (!tokens.length) {
      await qDoc.ref.set(
        {
          status: "skipped",
          reason: "no_devices",
          processedAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
      continue;
    }

    const response = await admin.messaging().sendEachForMulticast({
      tokens,
      notification: {
        title: String(q.title || "HitALick Alert"),
        body: String(q.body || "New elite alert triggered."),
      },
      data: Object.fromEntries(
        Object.entries(q.payload || {}).map(([k, v]) => [k, typeof v === "string" ? v : JSON.stringify(v)])
      ),
    });

    await qDoc.ref.set(
      {
        status: response.failureCount > 0 ? "partial" : "sent",
        processedAt: admin.firestore.FieldValue.serverTimestamp(),
        sentCount: response.successCount,
        failedCount: response.failureCount,
      },
      { merge: true }
    );
    sent += response.successCount;
    failed += response.failureCount;
  }

  return { scanned: queueSnap.size, sent, failed };
}

async function updateOutcomeModel(uid, outcome = {}) {
  const ref = admin.firestore().collection("eliteUsers").doc(uid);
  await admin.firestore().runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const data = snap.exists ? snap.data() || {} : {};
    const model = data.modelV2 || {};

    const prevSamples = Number(model.samples || 0);
    const prevWins = Number(model.wins || 0);
    const prevWinRate = Number(model.winRate || 0.5);
    const prevClv = Number(model.avgCloseLineDelta || 0);
    const prevHold = Number(model.avgHoldMinutes || 30);

    const didWin = Boolean(outcome.didWin);
    const closeLineDelta = Number(outcome.closeLineDelta || 0);
    const pickHoldMinutes = Number(outcome.pickHoldMinutes || 0);

    const samples = prevSamples + 1;
    const wins = prevWins + (didWin ? 1 : 0);
    const winRate = wins / Math.max(1, samples);
    const avgCloseLineDelta = (prevClv * prevSamples + closeLineDelta) / Math.max(1, samples);
    const avgHoldMinutes = (prevHold * prevSamples + pickHoldMinutes) / Math.max(1, samples);
    const behaviorBoost = computeBehaviorBoost({ winRate, avgCloseLineDelta, avgHoldMinutes });

    tx.set(
      ref,
      {
        modelV2: {
          samples,
          wins,
          winRate: Number(winRate.toFixed(4)),
          avgCloseLineDelta: Number(avgCloseLineDelta.toFixed(3)),
          avgHoldMinutes: Number(avgHoldMinutes.toFixed(2)),
          behaviorBoost,
          riskBand: rankToRiskBand(behaviorBoost * 100),
          lastUpdated: admin.firestore.FieldValue.serverTimestamp(),
          previousWinRate: Number(prevWinRate.toFixed(4)),
        },
      },
      { merge: true }
    );
  });
}

function rankingProfileFromDoc(data = {}) {
  const modelV2 = data.modelV2 || {};
  const behaviorBoost = Number(modelV2.behaviorBoost || computeBehaviorBoost(modelV2));
  return {
    samples: Number(modelV2.samples || 0),
    wins: Number(modelV2.wins || 0),
    winRate: Number(modelV2.winRate || 0.5),
    avgCloseLineDelta: Number(modelV2.avgCloseLineDelta || 0),
    avgHoldMinutes: Number(modelV2.avgHoldMinutes || 30),
    behaviorBoost,
    riskBand: modelV2.riskBand || rankToRiskBand(behaviorBoost * 100),
    lastUpdated: modelV2.lastUpdated || null,
  };
}

export {
  TIER_RANK,
  normalizeTier,
  featureFlagsForTier,
  evaluateUserAlerts,
  dispatchPendingNotifications,
  updateOutcomeModel,
  rankingProfileFromDoc,
  computeBehaviorBoost,
};

