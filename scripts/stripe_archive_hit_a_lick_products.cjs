#!/usr/bin/env node
/**
 * Deactivates (archives) Stripe **Products** that belong ONLY to Hit-A-Lick.
 *
 * Safety: only touches products where `metadata.hit_a_lick === "1"`.
 * Other apps sharing the same Stripe account are unaffected.
 *
 * Run:
 *   STRIPE_SECRET_KEY=sk_... node scripts/stripe_archive_hit_a_lick_products.cjs
 *
 * Tag new Hit-A-Lick catalog items with metadata when you create them
 * (see `hitlick_stripe_catalog_bootstrap.cjs`).
 */

const Stripe = require("../functions/node_modules/stripe");

const secret = process.env.STRIPE_SECRET_KEY;
if (!secret) {
  console.error("Missing STRIPE_SECRET_KEY");
  process.exit(1);
}

const stripe = new Stripe(secret);

async function main() {
  let startingAfter;
  let archived = 0;
  for (;;) {
    const params = { active: true, limit: 100 };
    if (startingAfter) params.starting_after = startingAfter;
    const page = await stripe.products.list(params);
    for (const p of page.data) {
      if (String(p.metadata?.hit_a_lick || "") !== "1") continue;
      await stripe.products.update(p.id, { active: false });
      console.log("Archived:", p.id, p.name);
      archived += 1;
    }
    if (!page.has_more) break;
    startingAfter = page.data[page.data.length - 1].id;
  }
  console.log("Done. Archived count:", archived);
}

main().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
