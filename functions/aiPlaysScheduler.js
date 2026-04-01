import { onSchedule } from "firebase-functions/v2/scheduler";
import admin from "firebase-admin";
import { AI_PLAYS_SPORTS, computeAiPlaysOfTheDayFromProps } from "./aiPlaysOfDayCore.js";

const OWNER_EMAIL = (process.env.OWNER_EMAIL || "brucebrian50@gmail.com").toLowerCase();
const TZ = String(process.env.AI_PLAYS_TZ || "America/New_York").trim() || "America/New_York";

function calendarDateKeyInZone(now, timeZone) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

async function loadPropsAllSports(db) {
  const all = [];
  for (const sport of AI_PLAYS_SPORTS) {
    const snap = await db.collection("props").where("sport", "==", sport).limit(500).get();
    for (const doc of snap.docs) {
      all.push(doc.data() || {});
    }
  }
  return all;
}

/**
 * Every day at 6:00 in AI_PLAYS_TZ (default America/New_York):
 * - Recompute top 3 player-prop legs from Firestore props across NBA/NFL/MLB/WNBA
 * - Save public snapshot to systemSettings/aiPlaysDaily
 * - Publish one Bruce-lane feed post (idempotent doc id per calendar day)
 */
export const publishDailyAiPlays = onSchedule(
  {
    schedule: "0 6 * * *",
    timeZone: TZ,
    memory: "512MiB",
    timeoutSeconds: 540,
  },
  async () => {
    const db = admin.firestore();
    const now = new Date();
    const dateKey = calendarDateKeyInZone(now, TZ);

    const allProps = await loadPropsAllSports(db);
    const picks = computeAiPlaysOfTheDayFromProps(allProps, 3);

    await db.collection("systemSettings").doc("aiPlaysDaily").set(
      {
        dateKey,
        timeZone: TZ,
        picks,
        propCountSampled: allProps.length,
        generatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

    const postId = `daily_ai_plays_${dateKey}`;
    const postRef = db.collection("curatorFeedPosts").doc(postId);
    const existing = await postRef.get();
    if (existing.exists) {
      return;
    }

    const lines = picks.length
      ? picks.map((p, i) => {
          const sentence = p.propSentence || p.propText || p.label || "prop";
          const quoteBits = Array.isArray(p.quotes)
            ? p.quotes
                .map((q) => {
                  const o = Number(q.odds);
                  const od = Number.isFinite(o) ? (o > 0 ? `+${o}` : String(o)) : "";
                  return od ? `${q.bookKey} ${od}` : "";
                })
                .filter(Boolean)
            : [];
          const booksStr = quoteBits.length ? quoteBits.join(" · ") : `${p.bookKey} ${p.odds}`;
          return `${i + 1}) ${sentence} — ${p.sport} — ${p.matchup} — ${booksStr} — ${p.confidence}% conf.`;
        })
      : [
          "No qualifying player props met the filters this morning (60%+ conf., priced book, odds no worse than -190). Refresh props and check the AI tab.",
        ];

    const body = `🤖 AI plays of the day (${dateKey} · ${TZ})\n\n${lines.join("\n")}\n\nEducational analytics only — not betting advice.`;

    await postRef.set({
      authorSlug: "bruce",
      authorLabel: "Bruce Pick's",
      body,
      imageUrl: null,
      commentCount: 0,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      createdBy: OWNER_EMAIL,
      kind: "ai_daily",
    });
  }
);
