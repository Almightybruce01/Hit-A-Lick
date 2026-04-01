#!/usr/bin/env node
/**
 * Hit-A-Lick-only Stripe catalog (safe on shared Stripe accounts):
 * 1) Archives products that have metadata `app=hitalick` (does not touch other apps).
 * 2) Creates fresh products + prices for Regular, Premium AI add-on, Bruce picks, Giap picks, +50 AI credits (one-time).
 * 3) Creates coupon 25% off applying ONLY to Regular + Premium AI products, and promotion code HITALICK25.
 *
 * Run (from repo root):
 *   STRIPE_SECRET_KEY=sk_live_xxx node scripts/hitalick_stripe_catalog.mjs
 *
 * Then set Firebase secrets from the printed lines. Restrict the coupon in Dashboard if needed
 * (Stripe applies_to should limit to the two subscription products).
 */

import { createRequire } from "module";
import { fileURLToPath } from "url";
import path from "path";

const require = createRequire(import.meta.url);
const Stripe = require(path.join(fileURLToPath(new URL(".", import.meta.url)), "../functions/node_modules/stripe"));

const secret = process.env.STRIPE_SECRET_KEY;
if (!secret) {
  console.error("Set STRIPE_SECRET_KEY");
  process.exit(1);
}

const stripe = new Stripe(secret);

const AMOUNTS = {
  regularUsd: Number(process.env.HITALICK_REGULAR_USD || 19.99),
  premiumAiUsd: Number(process.env.HITALICK_PREMIUM_AI_USD || 24.99),
  bruceUsd: Number(process.env.HITALICK_BRUCE_USD || 19.99),
  giapUsd: Number(process.env.HITALICK_GIAP_USD || 19.99),
  aiCreditsUsd: Number(process.env.HITALICK_AI_CREDITS_USD || 9.99),
};

async function archiveOldHitALickProducts() {
  let startingAfter;
  let archived = 0;
  for (;;) {
    const list = await stripe.products.list({ limit: 100, active: true, starting_after: startingAfter });
    for (const p of list.data) {
      if (String(p.metadata?.app || "") === "hitalick") {
        await stripe.products.update(p.id, { active: false });
        archived += 1;
        console.log("Archived product", p.id, p.name);
      }
    }
    if (!list.has_more) break;
    startingAfter = list.data[list.data.length - 1].id;
  }
  return archived;
}

async function createProduct(name, metaExtra = {}) {
  return stripe.products.create({
    name,
    metadata: { app: "hitalick", ...metaExtra },
  });
}

async function createMonthlyPrice(productId, unitUsd, lookupKey) {
  const amount = Math.round(unitUsd * 100);
  return stripe.prices.create({
    product: productId,
    unit_amount: amount,
    currency: "usd",
    recurring: { interval: "month" },
    lookup_key: lookupKey,
    transfer_lookup_key: true,
  });
}

async function createOneTimePrice(productId, unitUsd, lookupKey) {
  const amount = Math.round(unitUsd * 100);
  return stripe.prices.create({
    product: productId,
    unit_amount: amount,
    currency: "usd",
    lookup_key: lookupKey,
    transfer_lookup_key: true,
  });
}

async function main() {
  const n = await archiveOldHitALickProducts();
  console.log(`\nArchived ${n} prior Hit-A-Lick product(s) (metadata app=hitalick only).\n`);

  const prodRegular = await createProduct("Hit-A-Lick Regular", { sku: "regular" });
  const prodPremium = await createProduct("Hit-A-Lick Premium AI (add-on)", { sku: "premium_ai_addon" });
  const prodBruce = await createProduct("Hit-A-Lick Bruce Picks", { sku: "bruce_picks" });
  const prodGiap = await createProduct("Hit-A-Lick Giap Picks", { sku: "giap_picks" });
  const prodCredits = await createProduct("Hit-A-Lick AI +50 requests", { sku: "ai_credits_50" });

  const priceRegular = await createMonthlyPrice(prodRegular.id, AMOUNTS.regularUsd, "hitalick_regular_monthly");
  const pricePremium = await createMonthlyPrice(prodPremium.id, AMOUNTS.premiumAiUsd, "hitalick_premium_ai_monthly");
  const priceBruce = await createMonthlyPrice(prodBruce.id, AMOUNTS.bruceUsd, "hitalick_bruce_picks_monthly");
  const priceGiap = await createMonthlyPrice(prodGiap.id, AMOUNTS.giapUsd, "hitalick_giap_picks_monthly");
  const priceCredits = await createOneTimePrice(prodCredits.id, AMOUNTS.aiCreditsUsd, "hitalick_ai_credits_50");

  const coupon = await stripe.coupons.create({
    name: "Hit-A-Lick 25% Regular + Premium AI",
    percent_off: 25,
    duration: "once",
    applies_to: {
      products: [prodRegular.id, prodPremium.id],
    },
  });

  let promo;
  try {
    promo = await stripe.promotionCodes.create({
      coupon: coupon.id,
      code: "HITALICK25",
      active: true,
      restrictions: { first_time_transaction: true },
    });
  } catch (e) {
    console.warn("Promotion code HITALICK25 may already exist; create manually in Dashboard if needed:", e.message);
  }

  console.log("--- Set Firebase Functions secrets / env ---\n");
  console.log(`STRIPE_PRICE_REGULAR_MONTHLY=${priceRegular.id}`);
  console.log(`STRIPE_PRICE_PREMIUM_AI_MONTHLY=${pricePremium.id}`);
  console.log(`STRIPE_PRICE_BRUCE_PICKS_MONTHLY=${priceBruce.id}`);
  console.log(`STRIPE_PRICE_GIAP_PICKS_MONTHLY=${priceGiap.id}`);
  console.log(`STRIPE_PRICE_AI_CREDITS_50=${priceCredits.id}`);
  console.log(`\nCoupon id: ${coupon.id}`);
  if (promo) console.log(`Promotion code: HITALICK25 → ${promo.id}`);
  console.log("\nCheckout: Regular first, then Premium AI add-on. Bruce and Giap are separate subscriptions.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
