import express from "express";
import admin from "firebase-admin";

const router = express.Router();

/** Clears server-side device slot list for the signed-in user (after sign-out on old hardware, etc.). */
router.post("/clear-device-slots", async (req, res) => {
  try {
    const authHeader = req.headers.authorization || "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
    if (!token) {
      return res.status(401).json({ error: "Bearer token required.", code: "AUTH_REQUIRED" });
    }
    const decoded = await admin.auth().verifyIdToken(token);
    await admin.firestore().doc(`users/${decoded.uid}/private/deviceSlots`).delete();
    return res.json({ ok: true });
  } catch {
    return res.status(401).json({ error: "Invalid or expired token.", code: "TOKEN_INVALID" });
  }
});

export default router;
