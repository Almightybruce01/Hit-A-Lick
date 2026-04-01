/**
 * One-time / rare: create Hit-A-Lick-only Stripe products & prices (tags metadata for safe archival).
 *
 * Run from `functions/` (needs stripe in node_modules):
 *   STRIPE_SECRET_KEY=sk_... node bootstrapStripeHitAlick.mjs
 *
 * Prints env lines for Firebase secrets. Then create promotion code HITALICK25 in Dashboard
 * (or uncomment promo block) — coupon must apply only to Regular + Premium AI *products*.
 *
 * To archive only Hit-A-Lick products later without touching other apps:
 *   products have metadata { hitalick_app: "1" }
 */

import Stripe from "stripe";

const secret = process.env.STRIPE_SECRET_KEY;
if (!secret) {
  console.error("Set STRIPE_SECRET_KEY");
  process.exit(1);
}

const stripe = new Stripe(secret);

const META = { hitalick_app: "1" };

async function findOrCreateProduct(name) {
  const list = await stripe.products.list({ active: true, limit: 100 });
  const existing = list.data.find((p) => p.name === name && p.metadata?.hitalick_app === "1");
  if (existing) return existing;
  return stripe.products.create({ name, metadata: META });
}

async function findOrCreateRecurringPrice(productId, amountUsd, interval, lookupKey) {
  const amountCents = Math.round(amountUsd * 100);
  const list = await stripe.prices.list({ product: productId, active: true, limit: 100 });
  const existing = list.data.find(
    (p) =>
      p.unit_amount === amountCents &&
      p.currency === "usd" &&
      p.recurring?.interval === interval &&
      p.metadata?.hitalick_app === "1",
  );
  if (existing) return existing;
  return stripe.prices.create({
    product: productId,
    unit_amount: amountCents,
    currency: "usd",
    recurring: { interval },
    lookup_key: lookupKey,
    metadata: META,
  });
}

async function findOrCreateOneTimePrice(productId, amountUsd, lookupKey) {
  const amountCents = Math.round(amountUsd * 100);
  const list = await stripe.prices.list({ product: productId, active: true, limit: 100 });
  const existing = list.data.find(
    (p) =>
      !p.recurring &&
      p.unit_amount === amountCents &&
      p.currency === "usd" &&
      p.metadata?.hitalick_app === "1",
  );
  if (existing) return existing;
  return stripe.prices.create({
    product: productId,
    unit_amount: amountCents,
    currency: "usd",
    lookup_key: lookupKey,
    metadata: META,
  });
}

async function main() {
  const regularProduct = await findOrCreateProduct("Hit-A-Lick Regular");
  const premiumAiProduct = await findOrCreateProduct("Hit-A-Lick Premium AI");
  const bruceProduct = await findOrCreateProduct("Hit-A-Lick Bruce Picks");
  const giapProduct = await findOrCreateProduct("Hit-A-Lick Giap Picks");
  const aiPackProduct = await findOrCreateProduct("Hit-A-Lick AI Request Pack (+50)");

  const regularPrice = await findOrCreateRecurringPrice(regularProduct.id, 19.99, "month", "hitalick_regular_monthly");
  const premiumPrice = await findOrCreateRecurringPrice(
    premiumAiProduct.id,
    39.99,
    "month",
    "hitalick_premium_ai_monthly",
  );
  const brucePrice = await findOrCreateRecurringPrice(bruceProduct.id, 20, "month", "hitalick_bruce_picks_monthly");
  const giapPrice = await findOrCreateRecurringPrice(giapProduct.id, 20, "month", "hitalick_giap_picks_monthly");
  const aiCreditsPrice = await findOrCreateOneTimePrice(aiPackProduct.id, 9.99, "hitalick_ai_credits_50");

  console.log("\n--- Set these Firebase Function secrets ---\n");
  console.log(`STRIPE_PRICE_REGULAR_MONTHLY=${regularPrice.id}`);
  console.log(`STRIPE_PRICE_PREMIUM_AI_MONTHLY=${premiumPrice.id}`);
  console.log(`STRIPE_PRICE_BRUCE_PICKS_MONTHLY=${brucePrice.id}`);
  console.log(`STRIPE_PRICE_GIAP_PICKS_MONTHLY=${giapPrice.id}`);
  console.log(`STRIPE_PRICE_AI_CREDITS_50=${aiCreditsPrice.id}`);

  console.log("\n--- Stripe Dashboard: 25% off Regular + Premium AI only ---");
  console.log("1) Coupons → Create: 25% off, duration = repeating (e.g. 12 months) or forever.");
  console.log("2) Restrict applies_to → products:", regularProduct.id, premiumAiProduct.id);
  console.log("3) Promotion codes → create code HITALICK25 linked to that coupon.");
  console.log("\nProduct IDs (for applies_to):");
  console.log("  Regular:", regularProduct.id);
  console.log("  Premium AI:", premiumAiProduct.id);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
