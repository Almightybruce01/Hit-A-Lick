import { onSchedule } from "firebase-functions/v2/scheduler";
import admin from "firebase-admin";

const SPORTS = ["nba", "nfl", "mlb", "wnba"];

function seasonKeyForSport(now, sport) {
  const d = now instanceof Date ? now : new Date(now);
  const year = d.getUTCFullYear();
  const month = d.getUTCMonth() + 1;
  if (sport === "mlb") return `${year}`;
  if (month >= 8) return `${year}-${year + 1}`;
  return `${year - 1}-${year}`;
}

function keepSeasonKeys(sport, now = new Date()) {
  const current = seasonKeyForSport(now, sport);
  if (sport === "mlb") {
    const y = Number(current);
    return [String(y), String(y - 1)];
  }
  const [a, b] = current.split("-").map((x) => Number(x));
  return [`${a}-${b}`, `${a - 1}-${b - 1}`];
}

function retentionCutoffYmd(now = new Date()) {
  const cutoff = new Date(now.getTime());
  cutoff.setUTCDate(cutoff.getUTCDate() - 730);
  const y = cutoff.getUTCFullYear();
  const m = String(cutoff.getUTCMonth() + 1).padStart(2, "0");
  const d = String(cutoff.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

async function purgeSeasonHistoryCollection(collectionName) {
  const db = admin.firestore();
  let deleted = 0;
  for (const sport of SPORTS) {
    const keep = new Set(keepSeasonKeys(sport));
    const snap = await db.collection(collectionName).where("sport", "==", sport).limit(5000).get();
    if (snap.empty) continue;
    let batch = db.batch();
    let touched = 0;
    for (const doc of snap.docs) {
      const seasonKey = String(doc.data()?.seasonKey || "");
      if (keep.has(seasonKey)) continue;
      batch.delete(doc.ref);
      touched += 1;
      deleted += 1;
      if (touched >= 400) {
        await batch.commit();
        batch = db.batch();
        touched = 0;
      }
    }
    if (touched > 0) await batch.commit();
  }
  return deleted;
}

async function purgeOldStatsDocs() {
  const db = admin.firestore();
  const cutoff = retentionCutoffYmd();
  const snap = await db.collectionGroup("stats").where("date", "<", cutoff).limit(3000).get();
  if (snap.empty) return 0;
  let deleted = 0;
  let batch = db.batch();
  let pending = 0;
  for (const doc of snap.docs) {
    batch.delete(doc.ref);
    pending += 1;
    deleted += 1;
    if (pending >= 400) {
      await batch.commit();
      batch = db.batch();
      pending = 0;
    }
  }
  if (pending > 0) await batch.commit();
  return deleted;
}

export const pruneHistoricalData = onSchedule("every day 04:30", async () => {
  const deletedPropHistory = await purgeSeasonHistoryCollection("propHistory");
  const deletedGameHistory = await purgeSeasonHistoryCollection("gameHistory");
  const deletedStats = await purgeOldStatsDocs();
  await admin.firestore().collection("_ops").doc("dataRetention").set(
    {
      ts: admin.firestore.FieldValue.serverTimestamp(),
      deletedPropHistory,
      deletedGameHistory,
      deletedStats,
      note: "Kept only current and previous seasons.",
    },
    { merge: true }
  );
});

/** Daily heartbeat for ops visibility (no API spend — metadata only). */
export const dailyLiveOpsTick = onSchedule("every day 06:00", async () => {
  await admin.firestore().collection("_ops").doc("dailyLiveOps").set(
    {
      ts: admin.firestore.FieldValue.serverTimestamp(),
      message:
        "Daily tick: client refreshes + PROPS_LIVE_CACHE_TTL_SECONDS coalesce live Odds API pulls. Historical reads use propHistory/gameHistory in Firestore.",
      retentionSchedule: "04:30 UTC pruneHistoricalData",
    },
    { merge: true }
  );
});

const POST_GAME_SLACK_MS = 5 * 60 * 60 * 1000;

function parseEventDate(value) {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function propScheduledDateDoc(data) {
  if (data?.commenceTime) return parseEventDate(data.commenceTime);
  if (data?.date) return parseEventDate(`${data.date}T12:00:00Z`);
  return null;
}

function shouldDeleteStoredPropDoc(data, now = new Date()) {
  const when = propScheduledDateDoc(data);
  if (!when) {
    const dk = String(data.date || "").slice(0, 10);
    if (!dk) return false;
    const endOfDay = Date.parse(`${dk}T23:59:59.999Z`);
    return Number.isFinite(endOfDay) && now.getTime() > endOfDay + 3600000;
  }
  return now.getTime() > when.getTime() + POST_GAME_SLACK_MS;
}

/** Mirrors `pruneExpiredProps` in props.js — runs between API pulls so finished games drop off Firestore. */
export const propExpirySweep = onSchedule("every 6 hours", async () => {
  const db = admin.firestore();
  let deleted = 0;
  for (const sport of SPORTS) {
    const snap = await db.collection("props").where("sport", "==", sport).limit(900).get();
    if (snap.empty) continue;
    let batch = db.batch();
    let pending = 0;
    for (const doc of snap.docs) {
      const data = doc.data() || {};
      if (shouldDeleteStoredPropDoc(data)) {
        batch.delete(doc.ref);
        pending += 1;
        deleted += 1;
      }
      if (pending >= 400) {
        await batch.commit();
        batch = db.batch();
        pending = 0;
      }
    }
    if (pending > 0) await batch.commit();
  }
  await db.collection("_ops").doc("propExpirySweep").set(
    {
      ts: admin.firestore.FieldValue.serverTimestamp(),
      deletedDocs: deleted,
      sports: SPORTS,
    },
    { merge: true }
  );
});

