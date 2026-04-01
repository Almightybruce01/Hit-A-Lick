/**
 * Creates a 25% coupon limited to two products (Regular + Premium bundle) and promotion code HITALICK25.
 *
 *   HITALICK_REGULAR_PRODUCT_ID=prod_xxx HITALICK_PREMIUM_PRODUCT_ID=prod_yyy STRIPE_SECRET_KEY=sk_xxx node scripts/stripe_hit_lick_promo_25.cjs
 *
 * Stripe applies the discount only when the subscription contains one of those products.
 */

const Stripe = require("../functions/node_modules/stripe");

const secret = process.env.STRIPE_SECRET_KEY;
const reg = String(process.env.HITALICK_REGULAR_PRODUCT_ID || "").trim();
const prem = String(process.env.HITALICK_PREMIUM_PRODUCT_ID || "").trim();
const code = String(process.env.HITALICK_PROMO_CODE || "HITALICK25").trim();

if (!secret || !reg || !prem) {
  console.error("Need STRIPE_SECRET_KEY, HITALICK_REGULAR_PRODUCT_ID, HITALICK_PREMIUM_PRODUCT_ID");
  process.exit(1);
}

const stripe = new Stripe(secret);

async function main() {
  const coupon = await stripe.coupons.create({
    name: "Hit-A-Lick 25% Regular + Premium",
    percent_off: 25,
    duration: "once",
    applies_to: { products: [reg, prem] },
  });

  const promos = await stripe.promotionCodes.list({ limit: 20, code });
  const existing = promos.data.find((p) => p.code === code);
  if (existing) {
    await stripe.promotionCodes.update(existing.id, { active: true });
    console.log(`Updated existing promotion code ${code} → coupon ${coupon.id}`);
    return;
  }

  await stripe.promotionCodes.create({
    coupon: coupon.id,
    code,
    active: true,
    restrictions: { first_time_transaction: true },
  });
  console.log(`Created promotion code ${code} with coupon ${coupon.id} (25% off, products: ${reg}, ${prem})`);
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
