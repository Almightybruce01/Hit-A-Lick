/**
 * Slow brute-force on ops PIN / failed auth: track failures per client IP in Firestore.
 * Clears on successful ops auth (correct PIN or owner Bearer).
 */
import crypto from "crypto";
import admin from "firebase-admin";

/** Compare PIN without leaking length via timing (fixed-width buffer). */
export function opsPinConstantTimeEqual(sent, expected) {
  const a = Buffer.alloc(128, 0);
  const b = Buffer.alloc(128, 0);
  Buffer.from(String(sent), "utf8").copy(a, 0, 0, 127);
  Buffer.from(String(expected), "utf8").copy(b, 0, 0, 127);
  try {
    return crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

const COL = "_opsAuthRate";
const WINDOW_MS = Number(process.env.OPS_AUTH_WINDOW_MS || 15 * 60 * 1000);
const MAX_FAIL = Math.max(5, Number(process.env.OPS_AUTH_MAX_FAILURES || 12));

function clientIp(req) {
  const xff = req.headers["x-forwarded-for"];
  if (typeof xff === "string" && xff.length) {
    return xff.split(",")[0].trim().slice(0, 128);
  }
  const rip = req.ip || req.socket?.remoteAddress || "";
  return String(rip).slice(0, 128) || "unknown";
}

function ipDocId(ip) {
  return crypto.createHash("sha256").update(`ops|${ip}`).digest("hex").slice(0, 48);
}

export function getOpsClientIp(req) {
  return clientIp(req);
}

export async function assertOpsAuthNotRateLimited(req) {
  const ip = clientIp(req);
  const ref = admin.firestore().collection(COL).doc(ipDocId(ip));
  const snap = await ref.get();
  const now = Date.now();
  if (!snap.exists) return { ip, ref };
  const d = snap.data() || {};
  const windowStart = d.windowStart?.toMillis ? d.windowStart.toMillis() : 0;
  let count = Number(d.count || 0);
  if (!windowStart || now - windowStart > WINDOW_MS) {
    await ref.delete().catch(() => {});
    return { ip, ref };
  }
  if (count >= MAX_FAIL) {
    const retrySec = Math.max(1, Math.ceil((windowStart + WINDOW_MS - now) / 1000));
    const err = new Error(`Too many failed attempts. Retry after ${retrySec}s.`);
    err.statusCode = 429;
    err.retryAfterSec = retrySec;
    throw err;
  }
  return { ip, ref };
}

export async function recordOpsAuthFailure(ip) {
  const ref = admin.firestore().collection(COL).doc(ipDocId(ip));
  const now = Date.now();
  await admin.firestore().runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    let windowStart = now;
    let count = 1;
    if (snap.exists) {
      const d = snap.data() || {};
      const ws = d.windowStart?.toMillis ? d.windowStart.toMillis() : 0;
      const c = Number(d.count || 0);
      if (ws && now - ws <= WINDOW_MS) {
        windowStart = ws;
        count = c + 1;
      }
    }
    tx.set(ref, {
      count,
      windowStart: admin.firestore.Timestamp.fromMillis(windowStart),
      lastFailAt: admin.firestore.FieldValue.serverTimestamp(),
      ipHint: String(ip).slice(0, 64),
    });
  });
}

export async function clearOpsAuthFailures(ip) {
  const ref = admin.firestore().collection(COL).doc(ipDocId(ip));
  await ref.delete().catch(() => {});
}
