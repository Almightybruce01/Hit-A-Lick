#!/usr/bin/env node
/**
 * Hit-A-Lick Stripe catalog — safe on a shared Stripe account:
 * - Archives **only** products with metadata `app=hit_a_lick` (never touches other apps).
 * - Creates new products/prices for this app’s subscription model.
 * - Creates coupon **HITALICK25** (25% off) limited to Regular + Premium prices only
 *   (not Bruce/Giap picks, not AI credit packs).
 *
 * Prerequisites: `npm install` inside `functions/` (uses that Stripe SDK).
 *
 * Usage:
 *   STRIPE_SECRET_KEY=sk_live_xxx node scripts/stripe_hit_a_lick_catalog.js
 *
 * Then set printed `STRIPE_PRICE_*` values as Firebase Functions secrets and redeploy.
 */

const path = require("path");
const Stripe = require(path.join(__dirname, "../functions/node_modules/stripe"));

const META = { app: "hit_a_lick" };

function money(usd) {
  return Math.round(Number(usd) * 100);
}

async function archivePriorHitALickProducts(stripe) {
  let startingAfter;
  let total = 0;
  for (;;) {
    const list = await stripe.products.list({ limit: 100, starting_after: startingAfter });
    for (const p of list.data) {
      if (String(p.metadata?.app || "") === "hit_a_lick" && p.active) {
        await stripe.products.update(p.id, { active: false });
        console.log("Archived (hit_a_lick):", p.id, p.name);
        total += 1;
      }
    }
    if (!list.has_more) break;
    startingAfter = list.data[list.data.length - 1].id;
  }
  console.log(`Archived ${total} prior Hit-A-Lick product(s).\n`);
}

async function main() {
  const secret = process.env.STRIPE_SECRET_KEY;
  if (!secret) {
    throw new Error("Set STRIPE_SECRET_KEY in the environment.");
  }
  const stripe = new Stripe(secret);

  await archivePriorHitALickProducts(stripe);

  async function mkProduct(name, sku) {
    return stripe.products.create({
      name,
      metadata: { ...META, sku },
    });
  }

  async function mkMonthlyPrice(productId, amountUsd, lookupKey) {
    return stripe.prices.create({
      product: productId,
      currency: "usd",
      unit_amount: money(amountUsd),
      recurring: { interval: "month" },
      lookup_key: lookupKey,
    });
  }

  const prodRegular = await mkProduct("Hit-A-Lick Regular", "regular");
  const prodPremBundle = await mkProduct("Hit-A-Lick Premium (App + Unlimited AI)", "premium_bundle");
  const prodPremAddon = await mkProduct("Hit-A-Lick Premium AI Add-on", "premium_ai_addon");
  const prodBruce = await mkProduct("Hit-A-Lick Bruce Picks", "bruce_picks");
  const prodGiap = await mkProduct("Hit-A-Lick Giap Picks", "giap_picks");
  const prodCredits = await mkProduct("Hit-A-Lick AI Requests +50", "ai_credits_50");

  /** Adjust amounts here to match your pricing page. */
  const priceRegular = await mkMonthlyPrice(prodRegular.id, 19.99, "hitalick_regular_monthly_v3");
  const pricePremBundle = await mkMonthlyPrice(prodPremBundle.id, 49.99, "hitalick_premium_bundle_monthly_v3");
  const pricePremAddon = await mkMonthlyPrice(prodPremAddon.id, 29.99, "hitalick_premium_ai_addon_monthly_v3");
  const priceBruce = await mkMonthlyPrice(prodBruce.id, 19.99, "hitalick_bruce_picks_monthly_v3");
  const priceGiap = await mkMonthlyPrice(prodGiap.id, 19.99, "hitalick_giap_picks_monthly_v3");
  const priceCredits = await stripe.prices.create({
    product: prodCredits.id,
    currency: "usd",
    unit_amount: money(9.99),
    lookup_key: "hitalick_ai_credits_50_v3",
  });

  const coupon = await stripe.coupons.create({
    percent_off: 25,
    duration: "once",
    name: "HITALICK25 25% Reg+Prem one-time",
    applies_to: {
      products: [prodRegular.id, prodPremBundle.id, prodPremAddon.id],
    },
  });

  let promoNote = "";
  try {
    await stripe.promotionCodes.create({
      promotion: { type: "coupon", coupon: coupon.id },
      code: "HITALICK25",
      active: true,
      restrictions: { first_time_transaction: true },
    });
    promoNote = "Created promotion code HITALICK25.";
  } catch (e) {
    promoNote = `Promotion code step: ${e.message} (if code exists, reuse coupon ${coupon.id}).`;
  }

  console.log("\n--- Firebase Functions secrets (copy/paste) ---\n");
  console.log(`STRIPE_PRICE_REGULAR_MONTHLY=${priceRegular.id}`);
  console.log(`STRIPE_PRICE_PREMIUM_BUNDLE_MONTHLY=${pricePremBundle.id}`);
  console.log(`STRIPE_PRICE_PREMIUM_AI_ADDON_MONTHLY=${pricePremAddon.id}`);
  console.log(`STRIPE_PRICE_BRUCE_PICKS_MONTHLY=${priceBruce.id}`);
  console.log(`STRIPE_PRICE_GIAP_PICKS_MONTHLY=${priceGiap.id}`);
  console.log(`STRIPE_PRICE_AI_CREDITS_50=${priceCredits.id}`);
  console.log(`\nCoupon: ${coupon.id} — ${promoNote}`);
  console.log("\nWebhook must listen for checkout.session.completed (AI credits) and subscription events.\n");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
