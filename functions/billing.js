import express from "express";
import admin from "firebase-admin";
import Stripe from "stripe";

const router = express.Router();

function firstPriceId(...candidates) {
  for (const c of candidates) {
    const s = String(c || "").trim();
    if (s) return s;
  }
  return "";
}

/** Checkout uses these keys; set secrets in Firebase (see `functions/.env.example`). */
const PRICE_IDS = {
  core: firstPriceId(
    process.env.STRIPE_PRICE_CORE_MONTHLY,
    process.env.STRIPE_PRICE_BRUCE_MONTHLY,
    "price_1T5ZcJFOg1Vq3X9HLk2IzHlC",
  ),
  bruce: firstPriceId(
    process.env.STRIPE_PRICE_BRUCE_PICKS_MONTHLY,
    process.env.STRIPE_PRICE_BRUCE_ANNUAL,
    "price_1T5ZcJFOg1Vq3X9H2IuulHPh",
  ),
  premium: firstPriceId(
    process.env.STRIPE_PRICE_BRUCE_PREMIUM_MONTHLY,
    process.env.STRIPE_PRICE_BRUCE_ELITE_VIP,
    "price_1T5ZcKFOg1Vq3X9HvtSPUMQq",
  ),
  curator_giap: firstPriceId(process.env.STRIPE_PRICE_CURATOR_GIAP, process.env.STRIPE_PRICE_GIAP),
  curator_bruce: firstPriceId(process.env.STRIPE_PRICE_CURATOR_BRUCE, process.env.STRIPE_PRICE_BRUCE_CURATOR),
  all_curators: firstPriceId(process.env.STRIPE_PRICE_ALL_CURATORS, process.env.STRIPE_PRICE_CURATORS_ALL),
};

function getStripeClient() {
  if (!process.env.STRIPE_SECRET_KEY) {
    throw new Error("Missing STRIPE_SECRET_KEY");
  }
  return new Stripe(process.env.STRIPE_SECRET_KEY);
}

function requireField(value, field) {
  if (!value || String(value).trim().length === 0) {
    throw new Error(`Missing required field: ${field}`);
  }
}

const ALL_CURATOR_IDS = ["bruce", "giap"];

async function syncStripeSubscriptionDoc(uid, subscription) {
  const db = admin.firestore();
  const ref = db.collection("users").doc(uid).collection("stripeSubscriptions").doc(subscription.id);
  const curatorsMeta = String(subscription.metadata?.curators || "").trim();
  const tier = String(subscription.metadata?.tier || "core").toLowerCase();
  await ref.set(
    {
      status: subscription.status,
      curators: curatorsMeta.toLowerCase(),
      tier,
      stripeCustomerId: subscription.customer || null,
      subscriptionId: subscription.id,
      currentPeriodEnd: subscription.current_period_end
        ? admin.firestore.Timestamp.fromDate(new Date(subscription.current_period_end * 1000))
        : null,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    },
    { merge: true }
  );
}

/**
 * Merge all Stripe subscription rows for a user so curator passes combine and
 * bundle (`metadata.curators=all`) wins. Avoids double-billing overlap in-app by
 * granting widest access when any active sub is a bundle.
 */
async function recomputeEntitlementFromSubscriptions(uid) {
  const db = admin.firestore();
  const userRef = db.collection("users").doc(uid);
  const userSnap = await userRef.get();
  const prev = userSnap.exists ? userSnap.data()?.entitlement || {} : {};

  const subsSnap = await userRef.collection("stripeSubscriptions").get();
  if (subsSnap.empty) {
    return;
  }

  let anyActive = false;
  let curatorAllAccess = false;
  const curatorSet = new Set();
  let stripeCustomerId = null;
  let bestSubId = null;
  let bestEndMs = -1;
  let bestPeriodEnd = null;

  for (const doc of subsSnap.docs) {
    const d = doc.data() || {};
    const st = String(d.status || "");
    if (st !== "active" && st !== "trialing") continue;
    anyActive = true;

    const cm = String(d.curators || "").trim().toLowerCase();
    if (cm === "all" || cm === "*") {
      curatorAllAccess = true;
    } else if (cm) {
      cm.split(",").forEach((x) => {
        const s = x.trim().toLowerCase();
        if (s) curatorSet.add(s);
      });
    }

    const tier = String(d.tier || "").toLowerCase();
    if (tier === "premium") curatorAllAccess = true;
    if (tier.startsWith("curator_")) {
      const slug = tier.slice("curator_".length);
      if (ALL_CURATOR_IDS.includes(slug)) curatorSet.add(slug);
    } else if (tier === "bruce") {
      const single = cm && !cm.includes(",") && cm !== "all" && cm !== "*" ? cm : "";
      if (single && ALL_CURATOR_IDS.includes(single)) {
        curatorSet.add(single);
      } else {
        curatorSet.add("bruce");
      }
    }

    const cid = d.stripeCustomerId || null;
    if (cid) stripeCustomerId = cid;
    const endMs = d.currentPeriodEnd?.toMillis ? d.currentPeriodEnd.toMillis() : 0;
    if (endMs >= bestEndMs) {
      bestEndMs = endMs;
      bestSubId = d.subscriptionId || doc.id;
      bestPeriodEnd = d.currentPeriodEnd || null;
    }
  }

  const curatorIds = curatorAllAccess ? ALL_CURATOR_IDS : [...curatorSet];
  let tierOut = "core";
  if (anyActive) {
    if (curatorAllAccess) tierOut = "premium";
    else if (curatorIds.length === 1) tierOut = `curator_${curatorIds[0]}`;
    else if (curatorIds.length > 1) tierOut = "premium";
    else tierOut = String(prev.tier || "core");
  }

  if (!anyActive) {
    await userRef.set(
      {
        entitlement: {
          ...prev,
          active: false,
          status: "canceled",
          curatorAllAccess: false,
          curatorIds: [],
          tier: "core",
          stripeSubscriptionId: null,
          currentPeriodEnd: null,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        },
      },
      { merge: true }
    );
    return;
  }

  await userRef.set(
    {
      entitlement: {
        ...prev,
        active: true,
        status: "active",
        tier: tierOut,
        curatorAllAccess,
        curatorIds,
        stripeCustomerId: stripeCustomerId || prev.stripeCustomerId || null,
        stripeSubscriptionId: bestSubId || prev.stripeSubscriptionId || null,
        currentPeriodEnd: bestPeriodEnd || prev.currentPeriodEnd || null,
        source: "stripe_web",
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
    },
    { merge: true }
  );
}

async function upsertEntitlement({
  uid,
  tier,
  status,
  stripeCustomerId,
  stripeSubscriptionId,
  currentPeriodEnd,
}) {
  const db = admin.firestore();
  const userRef = db.collection("users").doc(uid);

  await userRef.set(
    {
      entitlement: {
        active: status === "active" || status === "trialing",
        tier,
        status,
        source: "stripe_web",
        stripeCustomerId: stripeCustomerId || null,
        stripeSubscriptionId: stripeSubscriptionId || null,
        currentPeriodEnd: currentPeriodEnd
          ? admin.firestore.Timestamp.fromDate(new Date(currentPeriodEnd * 1000))
          : null,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
    },
    { merge: true }
  );
}

function curatorMetaForTier(tierRaw) {
  const tier = String(tierRaw || "").toLowerCase();
  if (tier === "all_curators") return { tier: "premium", curators: "all" };
  if (tier.startsWith("curator_")) {
    const slug = tier.replace(/^curator_/, "");
    return { tier: `curator_${slug}`, curators: slug };
  }
  return { tier, curators: "" };
}

router.post("/create-checkout-session", async (req, res) => {
  try {
    const { uid, email, tier = "core", promoCode } = req.body || {};
    requireField(uid, "uid");
    requireField(email, "email");

    const priceId = PRICE_IDS[tier];
    if (!priceId) {
      return res.status(400).json({ error: `Invalid or unconfigured tier: ${tier}` });
    }

    const stripe = getStripeClient();
    const successUrl = process.env.APP_SUCCESS_URL || "https://hitalick.org/account?checkout=success";
    const cancelUrl = process.env.APP_CANCEL_URL || "https://hitalick.org/pricing?checkout=cancel";

    const meta = curatorMetaForTier(tier);

    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      payment_method_types: ["card"],
      customer_email: email,
      line_items: [{ price: priceId, quantity: 1 }],
      allow_promotion_codes: promoCode ? undefined : true,
      discounts: promoCode ? [{ promotion_code: promoCode }] : undefined,
      metadata: { uid, tier: meta.tier, curators: meta.curators },
      subscription_data: {
        metadata: { uid, tier: meta.tier, curators: meta.curators },
      },
      success_url: successUrl,
      cancel_url: cancelUrl,
    });

    return res.json({ url: session.url, sessionId: session.id });
  } catch (error) {
    return res.status(500).json({ error: error.message || "Checkout session failed" });
  }
});

router.post("/customer-portal", async (req, res) => {
  try {
    const { customerId, returnUrl } = req.body || {};
    requireField(customerId, "customerId");
    const stripe = getStripeClient();

    const session = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: returnUrl || "https://hitalick.org/account",
    });

    return res.json({ url: session.url });
  } catch (error) {
    return res.status(500).json({ error: error.message || "Portal session failed" });
  }
});

function mergeStaffEntitlement(base, email) {
  const e = String(email || "").toLowerCase();
  const owner = (process.env.OWNER_EMAIL || "brucebrian50@gmail.com").toLowerCase();
  const giap = String(process.env.CURATOR_GIAP_EMAIL || "giap.social1@gmail.com").trim().toLowerCase();
  const ent = base && typeof base === "object" ? { ...base } : {};

  if (e === owner) {
    return {
      ...ent,
      active: true,
      tier: "premium",
      curatorAllAccess: true,
      curatorIds: ALL_CURATOR_IDS,
      staffRole: "owner",
      aiUnlimited: true,
    };
  }
  if (giap && e === giap) {
    return {
      ...ent,
      active: true,
      tier: "curator_giap",
      curatorIds: ["giap"],
      curatorAllAccess: false,
      staffRole: "giap",
      aiUnlimited: true,
    };
  }
  return ent;
}

router.get("/entitlements/:uid", async (req, res) => {
  try {
    const uid = req.params.uid;
    requireField(uid, "uid");

    const doc = await admin.firestore().collection("users").doc(uid).get();
    const data = doc.exists ? doc.data() : {};
    let entitlement = data.entitlement || null;

    const authHeader = req.headers.authorization || "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
    if (token) {
      try {
        const decoded = await admin.auth().verifyIdToken(token);
        if (decoded.uid === uid) {
          entitlement = mergeStaffEntitlement(entitlement, decoded.email);
        }
      } catch {
        /* ignore — return stored entitlement only */
      }
    }

    return res.json({ entitlement });
  } catch (error) {
    return res.status(500).json({ error: error.message || "Entitlement lookup failed" });
  }
});

function maskPriceId(id) {
  const s = String(id || "");
  if (!s.length) return null;
  if (s.length <= 12) return `${s.slice(0, 4)}…`;
  return `${s.slice(0, 8)}…${s.slice(-4)}`;
}

/** Which Stripe price IDs resolve (masked). No secrets. */
router.get("/pricing-status", async (_req, res) => {
  try {
    const keys = ["core", "bruce", "premium", "curator_giap", "curator_bruce", "all_curators"];
    const prices = {};
    for (const k of keys) {
      const raw = PRICE_IDS[k];
      prices[k] = {
        configured: Boolean(String(raw || "").trim()),
        priceIdPreview: maskPriceId(raw),
      };
    }
    return res.json({
      ok: true,
      stripeSecretPresent: Boolean(process.env.STRIPE_SECRET_KEY),
      checkoutTiers: Object.keys(PRICE_IDS),
      prices,
    });
  } catch (error) {
    return res.status(500).json({ error: error.message || "pricing status failed" });
  }
});

async function handleStripeWebhook(req, res) {
  try {
    const stripe = getStripeClient();
    const sig = req.headers["stripe-signature"];
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

    if (!sig || !webhookSecret) {
      return res.status(400).send("Missing Stripe signature or webhook secret");
    }

    const event = stripe.webhooks.constructEvent(req.rawBody, sig, webhookSecret);

    if (
      event.type === "customer.subscription.created" ||
      event.type === "customer.subscription.updated" ||
      event.type === "customer.subscription.deleted"
    ) {
      const sub = event.data.object;
      const uid = sub.metadata?.uid;
      const tier = sub.metadata?.tier || "core";

      if (!uid) {
        return res.status(200).send("No uid in subscription metadata");
      }

      await syncStripeSubscriptionDoc(uid, sub);
      await recomputeEntitlementFromSubscriptions(uid);
    }

    return res.status(200).json({ received: true });
  } catch (error) {
    return res.status(400).send(`Webhook Error: ${error.message}`);
  }
}

export { router, handleStripeWebhook };
