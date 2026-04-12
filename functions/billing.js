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

/**
 * Stripe Price IDs look like `price_1AbCdEfGhIjKlMnO` (alphanumeric only after `price_`).
 * Placeholder strings such as `price_19_99_regular` are NOT valid and must never be set in secrets.
 */
export function isValidStripePriceId(id) {
  const s = String(id || "").trim();
  if (!s.startsWith("price_")) return false;
  const tail = s.slice(6);
  return tail.length >= 14 && /^[a-zA-Z0-9]+$/.test(tail);
}

function checkoutPriceError(label) {
  return (
    `Invalid Stripe price for ${label}. Run \`node scripts/stripe_hit_a_lick_catalog.js\` with STRIPE_SECRET_KEY, ` +
    `then set the printed STRIPE_PRICE_* values in Firebase Secret Manager (Functions → secrets) and redeploy. ` +
    `Do not use placeholder IDs like price_19_99_regular.`
  );
}

/** Checkout uses these keys; set secrets in Firebase (see `functions/.env.example`). */
/**
 * Default return URLs for Stripe checkout success/cancel (override with APP_SUCCESS_URL / APP_CANCEL_URL).
 * Primary: Firebase Hosting for this project. GitHub Pages users: set APP_PAGES_ORIGIN or the three APP_* URLs.
 */
/** Prefer custom domain so Stripe success/cancel URLs match where users sign in (override with APP_PAGES_ORIGIN). */
const HITALICK_PAGES_ORIGIN = process.env.APP_PAGES_ORIGIN || "https://hitalick.org";

/**
 * Hit-A-Lick only — Price IDs from Firebase secrets / env (no hard-coded price_ fallbacks).
 * regular = app access + 5 AI/mo (metered) + optional credit packs
 * premium checkout → `premium_bundle` (standalone) or `premium_ai_addon` (second sub after Regular)
 * bruce / giap = separate curator feeds (no combined Bruce+Giap SKU)
 */
/** Hit-A-Lick catalog only — narrow fallbacks (no cross-product SKU mixing). */
const priceRegular = firstPriceId(process.env.STRIPE_PRICE_REGULAR_MONTHLY, process.env.STRIPE_PRICE_CORE_MONTHLY);
const pricePremiumBundle = firstPriceId(
  process.env.STRIPE_PRICE_PREMIUM_BUNDLE_MONTHLY,
  process.env.STRIPE_PRICE_PREMIUM_MONTHLY,
);
const pricePremiumAddon = firstPriceId(
  process.env.STRIPE_PRICE_PREMIUM_AI_ADDON_MONTHLY,
  process.env.STRIPE_PRICE_PREMIUM_AI_MONTHLY,
);
const priceBrucePicks = firstPriceId(
  process.env.STRIPE_PRICE_BRUCE_PICKS_MONTHLY,
  process.env.STRIPE_PRICE_BRUCE_PICKS_SUB,
  process.env.STRIPE_PRICE_CURATOR_BRUCE,
);
const priceGiapPicks = firstPriceId(
  process.env.STRIPE_PRICE_GIAP_PICKS_MONTHLY,
  process.env.STRIPE_PRICE_CURATOR_GIAP,
  process.env.STRIPE_PRICE_GIAP,
);

const PRICE_IDS = {
  regular: priceRegular,
  core: priceRegular,
  premium: pricePremiumBundle,
  bruce: priceBrucePicks,
  giap: priceGiapPicks,
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

/** Reuse Stripe Customer on repeat checkouts so subscriptions group under one customer in Stripe. */
async function getExistingStripeCustomerId(uid) {
  const userRef = admin.firestore().collection("users").doc(uid);
  const userSnap = await userRef.get();
  const ent = userSnap.exists ? userSnap.data()?.entitlement || {} : {};
  const fromEnt = String(ent.stripeCustomerId || "").trim();
  if (fromEnt) return fromEnt;
  const subsSnap = await userRef.collection("stripeSubscriptions").limit(40).get();
  for (const d of subsSnap.docs) {
    const c = String(d.data()?.stripeCustomerId || "").trim();
    if (c) return c;
  }
  return "";
}

/** Portal / customer-id checks: Firebase uid must own this Stripe customer id in Firestore. */
async function uidOwnsStripeCustomer(uid, customerId) {
  const want = String(customerId || "").trim();
  if (!want) return false;
  const userRef = admin.firestore().collection("users").doc(uid);
  const userSnap = await userRef.get();
  const ent = userSnap.exists ? userSnap.data()?.entitlement || {} : {};
  if (String(ent.stripeCustomerId || "").trim() === want) return true;
  const subsSnap = await userRef.collection("stripeSubscriptions").get();
  for (const d of subsSnap.docs) {
    if (String(d.data()?.stripeCustomerId || "").trim() === want) return true;
  }
  return false;
}

async function requireUidBearerForCheckout(req, res, next) {
  try {
    const uid = String(req.body?.uid || "").trim();
    if (!uid) {
      return res.status(400).json({ error: "Missing uid.", code: "MISSING_UID" });
    }
    const authHeader = req.headers.authorization || "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
    if (!token) {
      return res.status(401).json({
        error: "Sign in on the account page, then return here for checkout.",
        code: "AUTH_REQUIRED",
      });
    }
    const decoded = await admin.auth().verifyIdToken(token);
    if (decoded.uid !== uid) {
      return res.status(403).json({
        error: "Your sign-in does not match this checkout. Log out and sign in again.",
        code: "UID_MISMATCH",
      });
    }
    return next();
  } catch {
    return res.status(401).json({
      error: "Session expired. Open account.html and sign in again.",
      code: "TOKEN_INVALID",
    });
  }
}

const ALL_CURATOR_IDS = ["bruce", "giap"];

/** Env-backed staff identities. Bruce primary = OWNER_EMAIL (must match Firebase login for merges). */
export function resolveStaffEmails() {
  return {
    owner: (process.env.OWNER_EMAIL || "brucebrian50@gmail.com").toLowerCase(),
    giap: String(process.env.CURATOR_GIAP_EMAIL || "giap.social1@gmail.com").trim().toLowerCase(),
    bruceCurator: String(process.env.CURATOR_BRUCE_EMAIL || "").trim().toLowerCase(),
  };
}

export function isUnlimitedStaffEmail(email) {
  const e = String(email || "").trim().toLowerCase();
  if (!e) return false;
  const { owner, giap, bruceCurator } = resolveStaffEmails();
  if (e === owner) return true;
  if (bruceCurator && e === bruceCurator) return true;
  if (giap && e === giap) return true;
  return false;
}

/** For AI quota / UI: owner | bruce (lane email) | giap */
export function staffLabelForEmail(email) {
  const e = String(email || "").trim().toLowerCase();
  const { owner, giap, bruceCurator } = resolveStaffEmails();
  if (e === owner) return "owner";
  if (bruceCurator && e === bruceCurator) return "bruce";
  if (giap && e === giap) return "giap";
  return null;
}

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
 * Merge Stripe subscription rows: regular / premium_ai / per-curator subs are independent.
 * No combined Bruce+Giap SKU — legacy `curators=all` maps to both slugs for old rows only.
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

  let hasRegular = false;
  let hasPremium = false;
  const curatorSet = new Set();
  let stripeCustomerId = null;
  let bestSubId = null;
  let bestEndMs = -1;
  let bestPeriodEnd = null;
  let sawActive = false;

  for (const doc of subsSnap.docs) {
    const d = doc.data() || {};
    const st = String(d.status || "");
    if (st !== "active" && st !== "trialing") continue;
    sawActive = true;

    const tier = String(d.tier || "").toLowerCase();
    const cm = String(d.curators || "").trim().toLowerCase();

    if (tier === "regular" || tier === "core") hasRegular = true;
    /** All-in-one Premium checkout (app + unlimited AI). */
    if (tier === "premium_bundle" || tier === "premium_all") {
      hasRegular = true;
      hasPremium = true;
    }
    /** Add-on: AI-only line item (must pair with Regular — legacy / separate price). */
    if (tier === "premium_ai_addon" || tier === "premium_ai_addon_only") {
      hasPremium = true;
    }
    /**
     * Legacy combined SKUs that used `premium_ai` for a single subscription with full app + AI.
     * New catalog uses `premium_ai_addon` for the AI add-on after Regular.
     */
    if (tier === "premium_ai" || tier === "premium_plus") {
      hasPremium = true;
      hasRegular = true;
    }
    if (tier === "premium") {
      hasRegular = true;
      hasPremium = true;
    }
    if (tier === "bruce") curatorSet.add("bruce");
    if (tier === "curator_bruce") curatorSet.add("bruce");
    if (tier === "curator_giap") curatorSet.add("giap");
    if (tier.startsWith("curator_")) {
      const slug = tier.slice("curator_".length);
      if (ALL_CURATOR_IDS.includes(slug)) curatorSet.add(slug);
    }

    if (cm === "all" || cm === "*") {
      ALL_CURATOR_IDS.forEach((id) => curatorSet.add(id));
    } else if (cm) {
      cm.split(",").forEach((x) => {
        const s = x.trim().toLowerCase();
        if (ALL_CURATOR_IDS.includes(s)) curatorSet.add(s);
      });
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

  const curatorIds = [...curatorSet].sort();
  /** Regular (base) membership unlocks the app. Premium AI add-on alone does not — avoids paying only for AI without base. */
  const hasAppAccess = Boolean(hasRegular);
  const active = hasAppAccess || curatorIds.length > 0;

  let tierOut = "none";
  if (hasRegular && hasPremium) tierOut = "premium_ai";
  else if (hasRegular) tierOut = "regular";
  else if (hasPremium && !hasRegular) tierOut = "premium_ai_addon_only";
  else if (curatorIds.length === 1) tierOut = `curator_${curatorIds[0]}`;
  else if (curatorIds.length > 1) tierOut = "curator_multi";

  if (!sawActive) {
    await userRef.set(
      {
        entitlement: {
          ...prev,
          active: false,
          status: "canceled",
          hasRegular: false,
          hasPremium: false,
          hasAppAccess: false,
          aiUnlimited: false,
          curatorAllAccess: false,
          curatorIds: [],
          tier: "none",
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
        active,
        status: "active",
        hasRegular,
        hasPremium,
        hasAppAccess,
        aiUnlimited: hasPremium,
        curatorAllAccess: false,
        curatorIds,
        tier: tierOut,
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
  if (tier === "regular" || tier === "core") return { tier: "regular", curators: "" };
  if (tier === "bruce") return { tier: "curator_bruce", curators: "bruce" };
  if (tier === "giap") return { tier: "curator_giap", curators: "giap" };
  return { tier, curators: "" };
}

/** Normalize Firestore entitlement for API clients (legacy rows before boolean fields). */
export function hydrateEntitlementForApi(ent = {}) {
  const e = { ...ent };
  const tierEarly = String(e.tier || "").toLowerCase();
  const sr = String(e.staffRole || "").toLowerCase();
  /** Owner / Giap / curator staff: always active full access — survives stale Stripe or bad merges. */
  if (tierEarly === "staff" || sr === "owner" || sr === "giap" || sr === "bruce") {
    const cr = Array.isArray(e.curatorIds) && e.curatorIds.length ? e.curatorIds.map((x) => String(x).toLowerCase()) : [...ALL_CURATOR_IDS];
    return {
      ...e,
      active: true,
      status: e.status || "active",
      tier: "staff",
      hasRegular: true,
      hasPremium: true,
      hasAppAccess: true,
      aiUnlimited: true,
      curatorAllAccess: true,
      curatorIds: cr,
    };
  }
  if (e.hasRegular !== undefined && e.hasPremium !== undefined) {
    e.hasAppAccess = Boolean(e.hasRegular);
    e.aiUnlimited = Boolean(e.aiUnlimited || (e.hasPremium && e.hasRegular));
    if (!Array.isArray(e.curatorIds)) e.curatorIds = [];
    return e;
  }
  const t = String(e.tier || "none").toLowerCase();
  const active = e.active === true;
  const cr = Array.isArray(e.curatorIds) ? e.curatorIds.map((x) => String(x).toLowerCase()) : [];
  if (!active) {
    return {
      ...e,
      hasRegular: false,
      hasPremium: false,
      hasAppAccess: false,
      aiUnlimited: false,
      curatorIds: cr,
    };
  }
  if (t === "premium_ai_addon_only") {
    return {
      ...e,
      hasRegular: false,
      hasPremium: true,
      hasAppAccess: false,
      aiUnlimited: false,
      curatorIds: cr,
    };
  }
  if (t === "premium_bundle" || t === "premium_all") {
    return {
      ...e,
      hasRegular: true,
      hasPremium: true,
      hasAppAccess: true,
      aiUnlimited: true,
      curatorIds: cr,
    };
  }
  if (t === "staff") {
    return {
      ...e,
      hasRegular: true,
      hasPremium: true,
      hasAppAccess: true,
      aiUnlimited: true,
      curatorIds: cr,
    };
  }
  if (t === "premium_ai") {
    return {
      ...e,
      hasRegular: true,
      hasPremium: true,
      hasAppAccess: true,
      aiUnlimited: true,
      curatorIds: cr,
    };
  }
  if (t === "regular" || t === "core") {
    return { ...e, hasRegular: true, hasPremium: false, hasAppAccess: true, aiUnlimited: false, curatorIds: cr };
  }
  if (t === "premium") {
    return { ...e, hasRegular: true, hasPremium: true, hasAppAccess: true, aiUnlimited: true, curatorIds: cr };
  }
  if (t.startsWith("curator_") || t === "curator_multi" || t === "bruce") {
    return { ...e, hasRegular: false, hasPremium: false, hasAppAccess: false, aiUnlimited: false, curatorIds: cr };
  }
  if (e.curatorAllAccess === true) {
    return {
      ...e,
      hasRegular: true,
      hasPremium: true,
      hasAppAccess: true,
      aiUnlimited: true,
      curatorIds: ALL_CURATOR_IDS,
    };
  }
  return { ...e, hasRegular: false, hasPremium: false, hasAppAccess: false, aiUnlimited: false, curatorIds: cr };
}

router.post("/create-checkout-session", requireUidBearerForCheckout, async (req, res) => {
  try {
    const { uid, email, tier = "regular", promoCode } = req.body || {};
    requireField(uid, "uid");
    requireField(email, "email");

    const userSnap = await admin.firestore().collection("users").doc(uid).get();
    const rawEnt = userSnap.exists ? userSnap.data()?.entitlement || {} : {};
    const ent = hydrateEntitlementForApi(mergeStaffEntitlement({ ...rawEnt }, String(email).toLowerCase()));
    const t = String(tier || "").toLowerCase();
    if (t === "regular" || t === "core") {
      if (ent.hasRegular) {
        return res.status(400).json({
          error: "Regular membership is already active on this account.",
          code: "ALREADY_SUBSCRIBED",
        });
      }
    }
    if (t === "premium") {
      if (ent.hasPremium && ent.hasRegular) {
        return res.status(400).json({
          error: "Premium AI is already active on this account.",
          code: "ALREADY_SUBSCRIBED",
        });
      }
    }
    if (t === "bruce") {
      if (!ent.hasAppAccess) {
        return res.status(400).json({
          error: "Subscribe to Regular or Premium on the website first, then add Bruce picks.",
          code: "NEEDS_APP_SUBSCRIPTION",
        });
      }
      const ids = Array.isArray(ent.curatorIds) ? ent.curatorIds.map((x) => String(x).toLowerCase()) : [];
      if (ids.includes("bruce")) {
        return res.status(400).json({
          error: "Bruce picks subscription is already active.",
          code: "ALREADY_SUBSCRIBED",
        });
      }
    }
    if (t === "giap") {
      if (!ent.hasAppAccess) {
        return res.status(400).json({
          error: "Subscribe to Regular or Premium on the website first, then add Giap picks.",
          code: "NEEDS_APP_SUBSCRIPTION",
        });
      }
      const ids = Array.isArray(ent.curatorIds) ? ent.curatorIds.map((x) => String(x).toLowerCase()) : [];
      if (ids.includes("giap")) {
        return res.status(400).json({
          error: "Giap picks subscription is already active.",
          code: "ALREADY_SUBSCRIBED",
        });
      }
    }

    let priceId = PRICE_IDS[tier];
    let meta = curatorMetaForTier(tier);
    if (t === "premium") {
      if (ent.hasRegular) {
        meta = { tier: "premium_ai_addon", curators: "" };
        priceId = firstPriceId(
          process.env.STRIPE_PRICE_PREMIUM_AI_ADDON_MONTHLY,
          process.env.STRIPE_PRICE_PREMIUM_AI_MONTHLY,
          pricePremiumAddon,
        );
      } else {
        meta = { tier: "premium_bundle", curators: "" };
        priceId = firstPriceId(
          process.env.STRIPE_PRICE_PREMIUM_BUNDLE_MONTHLY,
          process.env.STRIPE_PRICE_PREMIUM_MONTHLY,
          pricePremiumBundle,
        );
      }
    }

    if (!priceId || !isValidStripePriceId(priceId)) {
      return res.status(503).json({
        error: checkoutPriceError(tier),
        code: "STRIPE_PRICE_INVALID",
      });
    }

    const stripe = getStripeClient();
    const successUrl =
      process.env.APP_SUCCESS_URL || `${HITALICK_PAGES_ORIGIN}/account.html?checkout=success`;
    const cancelUrl =
      process.env.APP_CANCEL_URL || `${HITALICK_PAGES_ORIGIN}/pricing.html?checkout=cancel`;

    const existingCustomerId = await getExistingStripeCustomerId(uid);

    await admin
      .firestore()
      .collection("users")
      .doc(uid)
      .set(
        {
          email: String(email).toLowerCase(),
          firebaseUid: uid,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true },
      );

    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      payment_method_types: ["card"],
      ...(existingCustomerId
        ? { customer: existingCustomerId }
        : { customer_email: email }),
      client_reference_id: uid,
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
    const msg = String(error?.message || error || "Checkout session failed");
    let code = "CHECKOUT_FAILED";
    if (/STRIPE_SECRET_KEY|Missing STRIPE/i.test(msg)) code = "STRIPE_SECRET_MISSING";
    else if (/No such price|resource_missing/i.test(msg)) code = "STRIPE_PRICE_NOT_FOUND";
    return res.status(500).json({ error: msg, code });
  }
});

/** One-time AI request pack (e.g. +50 calls / month bucket). Webhook `checkout.session.completed` applies credits. */
router.post("/create-ai-credits-session", requireUidBearerForCheckout, async (req, res) => {
  try {
    const { uid, email } = req.body || {};
    requireField(uid, "uid");
    requireField(email, "email");
    const userSnap = await admin.firestore().collection("users").doc(uid).get();
    const rawEnt = userSnap.exists ? userSnap.data()?.entitlement || {} : {};
    const ent = hydrateEntitlementForApi(mergeStaffEntitlement({ ...rawEnt }, String(email).toLowerCase()));
    if (!ent.hasAppAccess) {
      return res.status(403).json({
        error: "Regular membership required before purchasing AI request packs.",
        code: "NEEDS_APP_SUBSCRIPTION",
      });
    }
    if (ent.hasPremium || ent.aiUnlimited) {
      return res.status(400).json({
        error: "Premium AI already includes unlimited requests — credit packs are not needed.",
        code: "ALREADY_UNLIMITED",
      });
    }
    const priceId = String(process.env.STRIPE_PRICE_AI_CREDITS_50 || "").trim();
    if (!priceId || !isValidStripePriceId(priceId)) {
      return res.status(503).json({
        error: checkoutPriceError("ai_credits"),
        code: "STRIPE_PRICE_INVALID",
      });
    }
    const stripe = getStripeClient();
    const successUrl =
      process.env.APP_SUCCESS_URL || `${HITALICK_PAGES_ORIGIN}/account.html?checkout=success`;
    const cancelUrl =
      process.env.APP_CANCEL_URL || `${HITALICK_PAGES_ORIGIN}/pricing.html?checkout=cancel`;

    const existingCustomerId = await getExistingStripeCustomerId(uid);

    await admin
      .firestore()
      .collection("users")
      .doc(uid)
      .set(
        {
          email: String(email).toLowerCase(),
          firebaseUid: uid,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true },
      );

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      payment_method_types: ["card"],
      ...(existingCustomerId
        ? { customer: existingCustomerId }
        : { customer_email: email }),
      client_reference_id: uid,
      line_items: [{ price: priceId, quantity: 1 }],
      metadata: { uid, kind: "ai_credits", creditCount: "50" },
      success_url: successUrl,
      cancel_url: cancelUrl,
    });
    return res.json({ url: session.url, sessionId: session.id });
  } catch (error) {
    const msg = String(error?.message || error || "AI credits checkout failed");
    let code = "CHECKOUT_FAILED";
    if (/STRIPE_SECRET_KEY|Missing STRIPE/i.test(msg)) code = "STRIPE_SECRET_MISSING";
    return res.status(500).json({ error: msg, code });
  }
});

router.post("/customer-portal", requireUidBearerForCheckout, async (req, res) => {
  try {
    const { uid, customerId, returnUrl } = req.body || {};
    requireField(customerId, "customerId");
    const ok = await uidOwnsStripeCustomer(uid, customerId);
    if (!ok) {
      return res.status(403).json({
        error:
          "That Stripe customer does not match this signed-in account. Subscribe on the Pricing page first, then refresh membership.",
        code: "CUSTOMER_MISMATCH",
      });
    }
    const stripe = getStripeClient();

    const session = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: returnUrl || `${HITALICK_PAGES_ORIGIN}/account.html`,
    });

    return res.json({ url: session.url });
  } catch (error) {
    return res.status(500).json({ error: error.message || "Portal session failed" });
  }
});

function mergeStaffEntitlement(base, email) {
  const e = String(email || "").toLowerCase();
  const { owner, giap, bruceCurator } = resolveStaffEmails();
  const ent = base && typeof base === "object" ? { ...base } : {};

  const isBruceStaff = e === owner || (Boolean(bruceCurator) && e === bruceCurator);
  if (isBruceStaff) {
    return {
      ...ent,
      active: true,
      status: "active",
      source: "staff_allowlist",
      tier: "staff",
      hasRegular: true,
      hasPremium: true,
      hasAppAccess: true,
      aiUnlimited: true,
      curatorAllAccess: true,
      curatorIds: ALL_CURATOR_IDS,
      staffRole: e === owner ? "owner" : "bruce",
    };
  }
  if (giap && e === giap) {
    return {
      ...ent,
      active: true,
      status: "active",
      source: "staff_allowlist",
      tier: "staff",
      hasRegular: true,
      hasPremium: true,
      hasAppAccess: true,
      aiUnlimited: true,
      curatorAllAccess: true,
      curatorIds: ALL_CURATOR_IDS,
      staffRole: "giap",
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
          entitlement = hydrateEntitlementForApi(mergeStaffEntitlement(entitlement || {}, decoded.email));
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
    const keys = ["regular", "core", "premium", "bruce", "giap"];
    const prices = {};
    for (const k of keys) {
      const raw = PRICE_IDS[k];
      const trimmed = String(raw || "").trim();
      prices[k] = {
        configured: Boolean(trimmed),
        validFormat: isValidStripePriceId(trimmed),
        priceIdPreview: maskPriceId(raw),
      };
    }
    const aiCredits = String(process.env.STRIPE_PRICE_AI_CREDITS_50 || "").trim();
    return res.json({
      ok: true,
      stripeSecretPresent: Boolean(process.env.STRIPE_SECRET_KEY),
      checkoutTiers: Object.keys(PRICE_IDS),
      prices,
      aiCreditsPack: {
        configured: Boolean(aiCredits),
        validFormat: isValidStripePriceId(aiCredits),
        priceIdPreview: maskPriceId(aiCredits),
      },
    });
  } catch (error) {
    return res.status(500).json({ error: error.message || "pricing status failed" });
  }
});

/**
 * Public: live USD amounts from Stripe for the pricing page (no auth).
 * Fails softly if secrets hold placeholder IDs until ops runs `scripts/stripe_hit_a_lick_catalog.js`.
 */
router.get("/catalog-prices", async (_req, res) => {
  try {
    if (!process.env.STRIPE_SECRET_KEY) {
      return res.status(503).json({ ok: false, error: "Stripe is not configured on the API." });
    }
    const stripe = getStripeClient();
    const fetchOne = async (id, key) => {
      const raw = String(id || "").trim();
      if (!raw || !isValidStripePriceId(raw)) {
        return {
          key,
          ok: false,
          code: "INVALID_OR_PLACEHOLDER_ID",
          amountUsd: null,
          interval: null,
          error: checkoutPriceError(key),
        };
      }
      try {
        const p = await stripe.prices.retrieve(raw);
        const unit = p.unit_amount != null ? Number(p.unit_amount) / 100 : null;
        return {
          key,
          ok: true,
          currency: p.currency || "usd",
          amountUsd: unit,
          interval: p.recurring?.interval || (p.type === "one_time" ? "one_time" : null),
        };
      } catch (e) {
        return {
          key,
          ok: false,
          code: "STRIPE_RETRIEVE_FAILED",
          amountUsd: null,
          interval: null,
          error: String(e?.message || e || "retrieve failed"),
        };
      }
    };
    const out = await Promise.all([
      fetchOne(priceRegular, "regular"),
      fetchOne(pricePremiumBundle, "premiumBundle"),
      fetchOne(pricePremiumAddon, "premiumAddon"),
      fetchOne(priceBrucePicks, "bruce"),
      fetchOne(priceGiapPicks, "giap"),
      fetchOne(String(process.env.STRIPE_PRICE_AI_CREDITS_50 || "").trim(), "aiCredits"),
    ]);
    const prices = {};
    for (const row of out) prices[row.key] = row;
    return res.json({ ok: true, prices });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message || "catalog-prices failed" });
  }
});

function stripeWebhookPayloadBuffer(req) {
  if (req.rawBody) {
    if (Buffer.isBuffer(req.rawBody)) return req.rawBody;
    if (typeof req.rawBody === "string") return Buffer.from(req.rawBody, "utf8");
  }
  if (Buffer.isBuffer(req.body)) return req.body;
  return null;
}

async function handleStripeWebhook(req, res) {
  try {
    const stripe = getStripeClient();
    const sig = req.headers["stripe-signature"];
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

    if (!sig || !webhookSecret) {
      return res.status(400).send("Missing Stripe signature or webhook secret");
    }

    const payload = stripeWebhookPayloadBuffer(req);
    if (!payload || !payload.length) {
      console.error("stripeWebhook: missing raw body for signature verification");
      return res.status(400).send("Missing raw body for Stripe signature verification");
    }

    const event = stripe.webhooks.constructEvent(payload, sig, webhookSecret);

    if (
      event.type === "customer.subscription.created" ||
      event.type === "customer.subscription.updated" ||
      event.type === "customer.subscription.deleted"
    ) {
      const sub = event.data.object;
      const uid = sub.metadata?.uid;

      if (!uid) {
        return res.status(200).send("No uid in subscription metadata");
      }

      await syncStripeSubscriptionDoc(uid, sub);
      await recomputeEntitlementFromSubscriptions(uid);
    }

    if (event.type === "checkout.session.completed") {
      const session = event.data.object;
      const uidFromSession = String(session.metadata?.uid || "").trim();

      /** Subscription checkouts: Stripe fires this in addition to customer.subscription.* — sync here so entitlements land even if subscription events are delayed or misconfigured. */
      if (session.mode === "subscription" && session.subscription) {
        const subId =
          typeof session.subscription === "string" ? session.subscription : session.subscription?.id || "";
        if (subId) {
          try {
            const sub = await stripe.subscriptions.retrieve(subId);
            const uid = String(sub.metadata?.uid || uidFromSession || "").trim();
            if (uid) {
              await syncStripeSubscriptionDoc(uid, sub);
              await recomputeEntitlementFromSubscriptions(uid);
            }
          } catch (e) {
            console.error("checkout.session.completed subscription sync failed:", e?.message || e);
          }
        }
      }

      const kind = String(session.metadata?.kind || "").trim();
      const uid = uidFromSession;
      if (uid && kind === "ai_credits" && session.mode === "payment") {
        const add = Math.max(0, Math.min(500, Number(session.metadata?.creditCount || 50)));
        if (add > 0) {
          const monthKey = new Date().toISOString().slice(0, 7);
          const ref = admin.firestore().collection("users").doc(uid).collection("privateStats").doc("aiMonthly");
          await admin.firestore().runTransaction(async (t) => {
            const snap = await t.get(ref);
            const d = snap.exists ? snap.data() || {} : {};
            const used = d.monthKey === monthKey ? Number(d.used || 0) : 0;
            const purchased = d.monthKey === monthKey ? Number(d.purchasedCredits || 0) : 0;
            t.set(
              ref,
              {
                monthKey,
                used,
                purchasedCredits: purchased + add,
                updatedAt: admin.firestore.FieldValue.serverTimestamp(),
              },
              { merge: true },
            );
          });
        }
      }
    }

    return res.status(200).json({ received: true });
  } catch (error) {
    return res.status(400).send(`Webhook Error: ${error.message}`);
  }
}

export { router, handleStripeWebhook, mergeStaffEntitlement };
