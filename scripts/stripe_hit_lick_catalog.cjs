/**
 * Creates Hit-A-Lick–only Stripe products (metadata hit_a_lick=1) and recurring prices.
 * Run from repo root with a restricted key that can write Products/Prices/Coupons/PromotionCodes:
 *
 *   STRIPE_SECRET_KEY=sk_test_xxx node scripts/stripe_hit_lick_catalog.cjs
 *
 * Prints env lines for Firebase secrets. Does not touch products without this metadata.
 *
 * After creation, run scripts/stripe_hit_lick_promo_25.cjs with the printed Regular + Premium product IDs
 * so promotion code HITALICK25 applies only to those two products.
 */

const Stripe = require("../functions/node_modules/stripe");

const secret = process.env.STRIPE_SECRET_KEY;
if (!secret) {
  console.error("Set STRIPE_SECRET_KEY");
  process.exit(1);
}

const stripe = new Stripe(secret);
const META = { hit_a_lick: "1" };

async function ensureProduct(name) {
  const list = await stripe.products.list({ active: true, limit: 100 });
  const found = list.data.find((p) => p.name === name && p.metadata?.hit_a_lick === "1");
  if (found) return found;
  return stripe.products.create({ name, metadata: META });
}

async function ensurePrice(productId, amountUsd, interval, nickname) {
  const cents = Math.round(Number(amountUsd) * 100);
  const prices = await stripe.prices.list({ product: productId, active: true, limit: 100 });
  const hit = prices.data.find(
    (p) =>
      p.unit_amount === cents &&
      p.currency === "usd" &&
      p.recurring?.interval === interval &&
      p.metadata?.hit_a_lick === "1",
  );
  if (hit) return hit;
  return stripe.prices.create({
    product: productId,
    unit_amount: cents,
    currency: "usd",
    recurring: { interval },
    metadata: META,
    nickname: nickname || undefined,
  });
}

async function main() {
  const regularProduct = await ensureProduct("Hit-A-Lick Regular");
  const premiumBundleProduct = await ensureProduct("Hit-A-Lick Premium (app + unlimited AI)");
  const premiumAddonProduct = await ensureProduct("Hit-A-Lick Premium AI add-on");
  const bruceProduct = await ensureProduct("Hit-A-Lick Bruce picks");
  const giapProduct = await ensureProduct("Hit-A-Lick Giap picks");
  const aiPackProduct = await ensureProduct("Hit-A-Lick AI +50 requests");

  const pRegular = await ensurePrice(regularProduct.id, 19.99, "month", "regular");
  const pBundle = await ensurePrice(premiumBundleProduct.id, 49.99, "month", "premium_bundle");
  const pAddon = await ensurePrice(premiumAddonProduct.id, 29.99, "month", "premium_ai_addon");
  const pBruce = await ensurePrice(bruceProduct.id, 20, "month", "bruce_picks");
  const pGiap = await ensurePrice(giapProduct.id, 20, "month", "giap_picks");
  const pPack = await stripe.prices.create({
    product: aiPackProduct.id,
    unit_amount: 999,
    currency: "usd",
    metadata: META,
    nickname: "ai_plus_50",
  });

  console.log("\n--- Set Firebase secrets (example amounts; edit prices in Dashboard if needed) ---\n");
  console.log(`STRIPE_PRICE_REGULAR_MONTHLY=${pRegular.id}`);
  console.log(`STRIPE_PRICE_PREMIUM_BUNDLE_MONTHLY=${pBundle.id}`);
  console.log(`STRIPE_PRICE_PREMIUM_AI_ADDON_MONTHLY=${pAddon.id}`);
  console.log(`STRIPE_PRICE_PREMIUM_AI_MONTHLY=${pBundle.id}`);
  console.log(`STRIPE_PRICE_BRUCE_PICKS_MONTHLY=${pBruce.id}`);
  console.log(`STRIPE_PRICE_GIAP_PICKS_MONTHLY=${pGiap.id}`);
  console.log(`STRIPE_PRICE_AI_CREDITS_50=${pPack.id}`);
  console.log("\n--- For 25% promo (Regular + Premium products only) ---\n");
  console.log(`HITALICK_REGULAR_PRODUCT_ID=${regularProduct.id}`);
  console.log(`HITALICK_PREMIUM_PRODUCT_ID=${premiumBundleProduct.id}`);
  console.log(
    "\nThen run: HITALICK_REGULAR_PRODUCT_ID=... HITALICK_PREMIUM_PRODUCT_ID=... node scripts/stripe_hit_lick_promo_25.cjs\n",
  );
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
