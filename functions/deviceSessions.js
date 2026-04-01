import admin from "firebase-admin";
import { FieldValue } from "firebase-admin/firestore";
import { isUnlimitedStaffEmail } from "./billing.js";

function maxDevices() {
  const n = parseInt(String(process.env.HITALICK_MAX_DEVICES || "2").trim(), 10);
  if (!Number.isFinite(n)) return 2;
  return Math.min(5, Math.max(1, n));
}

function normalizeDeviceId(raw) {
  const s = String(raw || "").trim();
  if (s.length < 8 || s.length > 200) return "";
  return s;
}

const LAST_SEEN_WRITE_MS = 5 * 60 * 1000;
/** Slots older than this are dropped so old phones/browsers don’t block new devices forever. */
const STALE_DEVICE_MS = Math.max(
  1,
  parseInt(String(process.env.HITALICK_DEVICE_STALE_DAYS || "45").trim(), 10) || 45,
) *
  24 *
  60 *
  60 *
  1000;

/**
 * For requests with a valid Firebase Bearer token: require X-Hit-Device-Id and
 * enforce up to HITALICK_MAX_DEVICES (default 2) concurrent devices per uid.
 * Staff (owner + Giap) bypass. No Bearer → next() (route handles auth).
 */
export async function deviceSessionGate(req, res, next) {
  try {
    const authHeader = req.headers.authorization || "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
    if (!token) return next();

    let decoded;
    try {
      decoded = await admin.auth().verifyIdToken(token);
    } catch {
      return next();
    }

    const email = String(decoded.email || "").toLowerCase();
    if (isUnlimitedStaffEmail(email)) return next();

    const deviceId = normalizeDeviceId(req.headers["x-hit-device-id"]);
    if (!deviceId) {
      return res.status(403).json({
        error:
          "This browser or app must send a device id. Hard-refresh the site or update the app, then sign in again.",
        code: "DEVICE_ID_REQUIRED",
      });
    }

    const uid = decoded.uid;
    const ref = admin.firestore().doc(`users/${uid}/private/deviceSlots`);
    const snap = await ref.get();
    const data = snap.exists ? snap.data() || {} : {};
    const rawValid = Array.isArray(data.slots)
      ? data.slots.filter((x) => x && typeof x.id === "string" && x.id.length >= 8)
      : [];

    const now = Date.now();
    const cap = maxDevices();
    let slots = rawValid.filter((s) => now - Number(s.lastSeenAt || 0) <= STALE_DEVICE_MS);
    const needsPruneWrite = slots.length !== rawValid.length;

    const hit = slots.find((s) => s.id === deviceId);

    if (hit) {
      const last = Number(hit.lastSeenAt || 0);
      if (now - last < LAST_SEEN_WRITE_MS) {
        if (needsPruneWrite) {
          await ref.set({ slots, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
        }
        return next();
      }
      slots = slots.map((s) => (s.id === deviceId ? { ...s, lastSeenAt: now } : s));
      await ref.set({ slots, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
      return next();
    }

    if (slots.length < cap) {
      slots.push({ id: deviceId, lastSeenAt: now });
      await ref.set({ slots, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
      return next();
    }

    return res.status(403).json({
      error: `This account is already active on ${cap} other devices. Sign out elsewhere or use Account → reset device slots.`,
      code: "DEVICE_LIMIT",
      maxDevices: cap,
    });
  } catch (e) {
    console.error("deviceSessionGate", e.message || e);
    return res.status(500).json({ error: "Device session check failed." });
  }
}
