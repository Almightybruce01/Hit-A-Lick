#!/usr/bin/env node
/**
 * Hit-A-Lick — four **single-use** Stripe promotion codes (25% off, **first invoice only**).
 * Coupon applies to products: Regular, Premium bundle, Premium AI add-on
 * (metadata `app=hit_a_lick` and sku `regular` | `premium_bundle` | `premium_ai_addon`).
 * Works for **monthly or yearly** prices on those products (same product in Stripe).
 *
 * Run after `stripe_hit_a_lick_catalog.js` so products exist.
 *
 *   cd functions && npm install && cd ..
 *   STRIPE_SECRET_KEY=sk_live_xxx node scripts/stripe_hit_a_lick_onetime_promos.cjs
 *
 * Codes created (each max_redemptions: 1) — share privately; do not commit redemptions:
 *   HL1REGM  — intended: Regular monthly (or any Regular price)
 *   HL1REGY  — intended: Regular yearly
 *   HL1PRMM  — intended: Premium monthly (bundle or add-on tier on those products)
 *   HL1PRMY  — intended: Premium yearly
 *
 * Stripe does not bind a code to a specific price ID; naming is operational only.
 */

const path = require("path");
const Stripe = require(path.join(__dirname, "../functions/node_modules/stripe"));

const ALLOWED_SKU = new Set(["regular", "premium_bundle", "premium_ai_addon"]);

const CODES = [
  { code: "HL1REGM", note: "Regular — first invoice (e.g. monthly)" },
  { code: "HL1REGY", note: "Regular — first invoice (e.g. yearly)" },
  { code: "HL1PRMM", note: "Premium — first invoice (e.g. monthly)" },
  { code: "HL1PRMY", note: "Premium — first invoice (e.g. yearly)" },
];

async function main() {
  const secret = process.env.STRIPE_SECRET_KEY;
  if (!secret) {
    throw new Error("Set STRIPE_SECRET_KEY in the environment.");
  }
  const stripe = new Stripe(secret);

  const products = [];
  let startingAfter;
  for (;;) {
    const page = await stripe.products.list({ limit: 100, active: true, starting_after: startingAfter });
    products.push(...page.data);
    if (!page.has_more) break;
    startingAfter = page.data[page.data.length - 1].id;
  }

  const hit = products.filter((p) => {
    if (String(p.metadata?.app || "") !== "hit_a_lick") return false;
    const sku = String(p.metadata?.sku || "").trim();
    return ALLOWED_SKU.has(sku);
  });

  if (!hit.length) {
    throw new Error(
      "No active Hit-A-Lick Regular/Premium products found (metadata app=hit_a_lick, sku in regular|premium_bundle|premium_ai_addon). Run scripts/stripe_hit_a_lick_catalog.js first.",
    );
  }

  const productIds = [...new Set(hit.map((p) => p.id))];
  console.log("Products on coupon:", productIds.join(", "));

  const coupon = await stripe.coupons.create({
    percent_off: 25,
    duration: "once",
    name: "HAL once 25% Reg+Prem",
    applies_to: { products: productIds },
  });
  console.log("Created coupon:", coupon.id, "(duration: once)\n");

  for (const { code, note } of CODES) {
    try {
      await stripe.promotionCodes.create({
        promotion: { type: "coupon", coupon: coupon.id },
        code,
        active: true,
        max_redemptions: 1,
        metadata: { app: "hit_a_lick", note },
      });
      console.log(`OK promotion code ${code} — ${note}`);
    } catch (e) {
      console.warn(`SKIP ${code}:`, e.message || e);
    }
  }

  console.log(`
--- Copy/paste (private) ---
Coupon ID: ${coupon.id}
Codes (one redemption each): HL1REGM, HL1REGY, HL1PRMM, HL1PRMY
If a code already existed, fix in Stripe Dashboard or pick new code strings and re-run with edits to CODES in this script.
`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
