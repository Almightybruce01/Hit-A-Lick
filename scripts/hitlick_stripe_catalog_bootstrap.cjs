#!/usr/bin/env node
/**
 * Creates Hit-A-Lick Stripe Products (tagged `metadata.hit_a_lick=1`) and recurring Prices,
 * plus a one-time price for +50 AI credits. Prints env lines for Firebase secrets.
 *
 * Does NOT delete or modify other apps' products.
 *
 *   STRIPE_SECRET_KEY=sk_test_... node scripts/hitlick_stripe_catalog_bootstrap.cjs
 *
 * Override amounts (USD) with env:
 *   HITALICK_AMOUNT_REGULAR, HITALICK_AMOUNT_PREMIUM_BUNDLE, HITALICK_AMOUNT_PREMIUM_AI_ADDON,
 *   HITALICK_AMOUNT_BRUCE_PICKS, HITALICK_AMOUNT_GIAP_PICKS, HITALICK_AMOUNT_AI_CREDITS_PACK
 */

const Stripe = require("../functions/node_modules/stripe");

const secret = process.env.STRIPE_SECRET_KEY;
if (!secret) {
  console.error("Missing STRIPE_SECRET_KEY");
  process.exit(1);
}

const stripe = new Stripe(secret);

const meta = { hit_a_lick: "1" };

const A = {
  regular: Number(process.env.HITALICK_AMOUNT_REGULAR_USD || 19.99),
  premiumBundle: Number(process.env.HITALICK_AMOUNT_PREMIUM_BUNDLE_USD || 49.99),
  premiumAiAddon: Number(process.env.HITALICK_AMOUNT_PREMIUM_AI_ADDON_USD || 19.99),
  bruce: Number(process.env.HITALICK_AMOUNT_BRUCE_PICKS_USD || 20),
  giap: Number(process.env.HITALICK_AMOUNT_GIAP_PICKS_USD || 20),
  credits: Number(process.env.HITALICK_AMOUNT_AI_CREDITS_PACK_USD || 9.99),
};

async function product(name) {
  const list = await stripe.products.list({ active: true, limit: 100 });
  const existing = list.data.find((p) => p.name === name && String(p.metadata?.hit_a_lick || "") === "1");
  if (existing) return existing;
  return stripe.products.create({ name, metadata: meta });
}

async function recurringPrice(productId, amountUsd, lookupKey) {
  const cents = Math.round(amountUsd * 100);
  const prices = await stripe.prices.list({ product: productId, active: true, limit: 100 });
  const hit = prices.data.find(
    (p) =>
      p.unit_amount === cents &&
      p.currency === "usd" &&
      p.recurring &&
      p.recurring.interval === "month",
  );
  if (hit) return hit;
  return stripe.prices.create({
    product: productId,
    unit_amount: cents,
    currency: "usd",
    recurring: { interval: "month" },
    lookup_key: lookupKey,
  });
}

async function oneTimePrice(productId, amountUsd, lookupKey) {
  const cents = Math.round(amountUsd * 100);
  const prices = await stripe.prices.list({ product: productId, active: true, limit: 100 });
  const hit = prices.data.find((p) => p.unit_amount === cents && p.currency === "usd" && !p.recurring);
  if (hit) return hit;
  return stripe.prices.create({
    product: productId,
    unit_amount: cents,
    currency: "usd",
    lookup_key: lookupKey,
  });
}

async function main() {
  const pRegular = await product("Hit-A-Lick Regular");
  const pBundle = await product("Hit-A-Lick Premium (app + unlimited AI)");
  const pAddon = await product("Hit-A-Lick Premium AI add-on");
  const pBruce = await product("Hit-A-Lick Bruce picks");
  const pGiap = await product("Hit-A-Lick Giap picks");
  const pCredits = await product("Hit-A-Lick AI requests +50");

  const prRegular = await recurringPrice(pRegular.id, A.regular, "hitalick_regular_monthly");
  const prBundle = await recurringPrice(pBundle.id, A.premiumBundle, "hitalick_premium_bundle_monthly");
  const prAddon = await recurringPrice(pAddon.id, A.premiumAiAddon, "hitalick_premium_ai_addon_monthly");
  const prBruce = await recurringPrice(pBruce.id, A.bruce, "hitalick_bruce_picks_monthly");
  const prGiap = await recurringPrice(pGiap.id, A.giap, "hitalick_giap_picks_monthly");
  const prCredits = await oneTimePrice(pCredits.id, A.credits, "hitalick_ai_credits_50");

  console.log("\n--- Set Firebase secrets / functions config (Price IDs) ---\n");
  console.log("STRIPE_PRICE_REGULAR_MONTHLY=" + prRegular.id);
  console.log("STRIPE_PRICE_PREMIUM_BUNDLE_MONTHLY=" + prBundle.id);
  console.log("STRIPE_PRICE_PREMIUM_AI_ADDON_MONTHLY=" + prAddon.id);
  console.log("STRIPE_PRICE_BRUCE_PICKS_MONTHLY=" + prBruce.id);
  console.log("STRIPE_PRICE_GIAP_PICKS_MONTHLY=" + prGiap.id);
  console.log("STRIPE_PRICE_AI_CREDITS_50=" + prCredits.id);

  console.log("\n--- For HITALICK25 promo (scripts/stripe_create_hitalick25.cjs) ---\n");
  console.log("HITALICK_STRIPE_PRODUCT_REGULAR=" + pRegular.id);
  console.log("HITALICK_STRIPE_PRODUCT_PREMIUM_BUNDLE=" + pBundle.id);
  console.log("HITALICK_STRIPE_PRODUCT_PREMIUM_AI_ADDON=" + pAddon.id);
}

main().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
