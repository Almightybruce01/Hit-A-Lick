#!/usr/bin/env node
/**
 * Creates a Stripe Coupon (25% off) limited to Hit-A-Lick Regular + Premium *products*,
 * and an active Promotion Code `HITALICK25`.
 *
 * Prerequisites:
 *   - Products already exist in Stripe (e.g. from `hitlick_stripe_catalog_bootstrap.cjs`).
 *   - Set product IDs (prod_...) — NOT price IDs:
 *       HITALICK_STRIPE_PRODUCT_REGULAR
 *       HITALICK_STRIPE_PRODUCT_PREMIUM_BUNDLE   (all-in-one Premium checkout product)
 *       HITALICK_STRIPE_PRODUCT_PREMIUM_AI_ADDON (optional — AI add-on after Regular)
 *
 * Run (test mode or live key):
 *   STRIPE_SECRET_KEY=sk_... \\
 *   HITALICK_STRIPE_PRODUCT_REGULAR=prod_xxx \\
 *   HITALICK_STRIPE_PRODUCT_PREMIUM_BUNDLE=prod_yyy \\
 *   HITALICK_STRIPE_PRODUCT_PREMIUM_AI_ADDON=prod_zzz \\
 *   node scripts/stripe_create_hitalick25.cjs
 *
 * If a code `HITALICK25` already exists, deactivate old codes in Dashboard or change PROMO_CODE below.
 */

const Stripe = require("../functions/node_modules/stripe");

const PROMO_CODE = "HITALICK25";

const secret = process.env.STRIPE_SECRET_KEY;
if (!secret) {
  console.error("Missing STRIPE_SECRET_KEY");
  process.exit(1);
}

const regular = process.env.HITALICK_STRIPE_PRODUCT_REGULAR;
const premBundle = process.env.HITALICK_STRIPE_PRODUCT_PREMIUM_BUNDLE;
const premAddon = process.env.HITALICK_STRIPE_PRODUCT_PREMIUM_AI_ADDON;

const products = [regular, premBundle, premAddon].filter(Boolean);
if (products.length < 2) {
  console.error(
    "Need at least HITALICK_STRIPE_PRODUCT_REGULAR and HITALICK_STRIPE_PRODUCT_PREMIUM_BUNDLE (and optionally HITALICK_STRIPE_PRODUCT_PREMIUM_AI_ADDON).",
  );
  process.exit(1);
}

const stripe = new Stripe(secret);

async function main() {
  const coupon = await stripe.coupons.create({
    percent_off: 25,
    duration: "once",
    name: "Hit-A-Lick 25% one-time — Regular & Premium only",
    applies_to: { products },
  });

  const promo = await stripe.promotionCodes.create({
    coupon: coupon.id,
    code: PROMO_CODE,
    active: true,
    restrictions: {
      first_time_transaction: true,
    },
  });

  console.log("OK — coupon:", coupon.id);
  console.log("OK — promotion code:", PROMO_CODE, "→", promo.id);
  console.log("Products restricted:", products.join(", "));
}

main().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
