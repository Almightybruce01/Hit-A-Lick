/*
  Deprecated for Hit-A-Lick — use `scripts/stripe_hit_lick_catalog.cjs` instead (tags products with metadata hit_a_lick=1).

  Usage:
    STRIPE_SECRET_KEY=sk_live_xxx node scripts/bootstrap_stripe_assets.js

  Creates (or reuses) paid-only subscriptions:
  - Core Membership $19.99/mo
  - Bruce Picks $20/mo
  - Bruce Premium Picks $50/mo
  Also creates dedicated 100% owner promo codes for each tier.
*/

const Stripe = require("../functions/node_modules/stripe");

const secret = process.env.STRIPE_SECRET_KEY;
if (!secret) {
  throw new Error("Missing STRIPE_SECRET_KEY in environment.");
}

const stripe = new Stripe(secret);

async function findOrCreateProduct(name) {
  const list = await stripe.products.list({ active: true, limit: 100 });
  const existing = list.data.find((p) => p.name === name);
  if (existing) return existing;
  return stripe.products.create({ name });
}

async function findOrCreateRecurringPrice(productId, amountUsd, interval, lookupKey) {
  const amountCents = Math.round(amountUsd * 100);
  const list = await stripe.prices.list({ product: productId, active: true, limit: 100 });
  const existing = list.data.find(
    (p) =>
      p.unit_amount === amountCents &&
      p.currency === "usd" &&
      p.recurring &&
      p.recurring.interval === interval
  );
  if (existing) return existing;
  return stripe.prices.create({
    product: productId,
    unit_amount: amountCents,
    currency: "usd",
    recurring: { interval },
    lookup_key: lookupKey,
  });
}

async function findOrCreateCouponAndCode() {
  const coupons = await stripe.coupons.list({ limit: 100 });
  const promoCodes = await stripe.promotionCodes.list({ limit: 100, active: true });

  async function ensureOne(couponName, code) {
    let coupon = coupons.data.find((c) => c.name === couponName);
    if (!coupon) {
      coupon = await stripe.coupons.create({
        name: couponName,
        percent_off: 100,
        duration: "once",
      });
    }

    let promo = promoCodes.data.find((p) => p.code === code);
    if (!promo) {
      promo = await stripe.promotionCodes.create({
        promotion: { type: "coupon", coupon: coupon.id },
        code,
        active: true,
      });
    }
    return { coupon, promo };
  }

  const core = await ensureOne("HitALick Core 100% Owner", "CORE100");
  const bruce = await ensureOne("HitALick Bruce Picks 100% Owner", "BRUCE100");
  const premium = await ensureOne("HitALick Premium Picks 100% Owner", "PREMIUM100");
  return { core, bruce, premium };
}

async function main() {
  const coreProduct = await findOrCreateProduct("Core Membership");
  const bruceProduct = await findOrCreateProduct("Bruce Picks");
  const premiumProduct = await findOrCreateProduct("Bruce Premium Picks");

  const corePrice = await findOrCreateRecurringPrice(
    coreProduct.id,
    19.99,
    "month",
    "hitalick_core_membership_monthly"
  );
  const brucePrice = await findOrCreateRecurringPrice(
    bruceProduct.id,
    20,
    "month",
    "hitalick_bruce_picks_monthly"
  );
  const premiumPrice = await findOrCreateRecurringPrice(
    premiumProduct.id,
    50,
    "month",
    "hitalick_bruce_premium_monthly"
  );

  const promos = await findOrCreateCouponAndCode();

  console.log("STRIPE_PRICE_CORE_MONTHLY=" + corePrice.id);
  console.log("STRIPE_PRICE_BRUCE_PICKS_MONTHLY=" + brucePrice.id);
  console.log("STRIPE_PRICE_BRUCE_PREMIUM_MONTHLY=" + premiumPrice.id);
  console.log("CORE_COUPON_ID=" + promos.core.coupon.id);
  console.log("CORE_PROMO_CODE=CORE100");
  console.log("CORE_PROMO_CODE_ID=" + promos.core.promo.id);
  console.log("BRUCE_COUPON_ID=" + promos.bruce.coupon.id);
  console.log("BRUCE_PROMO_CODE=BRUCE100");
  console.log("BRUCE_PROMO_CODE_ID=" + promos.bruce.promo.id);
  console.log("PREMIUM_COUPON_ID=" + promos.premium.coupon.id);
  console.log("PREMIUM_PROMO_CODE=PREMIUM100");
  console.log("PREMIUM_PROMO_CODE_ID=" + promos.premium.promo.id);
}

main().catch((err) => {
  console.error("Stripe bootstrap failed:", err.message);
  process.exit(1);
});
