import { onSchedule } from "firebase-functions/v2/scheduler";
import admin from "firebase-admin";
import { normalizeTier, TIER_RANK, evaluateUserAlerts, dispatchPendingNotifications } from "./eliteEngine.js";

const defaultAlertPrefs = {
  minEdgePct: 2.5,
  minConfidence: 58,
  minVelocity: 18,
  steamOnly: false,
};

export const processEliteAlerts = onSchedule("every 5 minutes", async () => {
  const usersSnap = await admin
    .firestore()
    .collection("users")
    .where("entitlement.active", "==", true)
    .limit(200)
    .get();

  let evaluatedUsers = 0;
  let totalAlerts = 0;
  for (const userDoc of usersSnap.docs) {
    const uid = userDoc.id;
    const userData = userDoc.data() || {};
    const tier = normalizeTier(userData?.entitlement?.tier || "core");
    if ((TIER_RANK[tier] || 1) < 2) continue;

    const eliteSnap = await admin.firestore().collection("eliteUsers").doc(uid).get();
    const eliteData = eliteSnap.exists ? eliteSnap.data() || {} : {};
    const alertPrefs = eliteData.alertPrefs || defaultAlertPrefs;
    const result = await evaluateUserAlerts({
      uid,
      tier,
      sport: "all",
      filters: alertPrefs,
      triggeredBy: "scheduler",
      maxProps: 500,
      maxAlerts: 80,
    });
    evaluatedUsers += 1;
    totalAlerts += Number(result.count || 0);
  }

  const dispatch = await dispatchPendingNotifications(140);
  await admin.firestore().collection("_ops").doc("eliteAlertsScheduler").set(
    {
      ts: admin.firestore.FieldValue.serverTimestamp(),
      evaluatedUsers,
      generatedAlerts: totalAlerts,
      dispatched: dispatch,
    },
    { merge: true }
  );
});

