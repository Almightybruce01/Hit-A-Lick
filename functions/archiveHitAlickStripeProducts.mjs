/**
 * Deactivate (archive) Stripe products that belong ONLY to Hit-A-Lick (metadata hitalick_app=1).
 * Does not touch other apps in a shared Stripe account.
 *
 *   STRIPE_SECRET_KEY=sk_... node archiveHitAlickStripeProducts.mjs --dry-run
 *   STRIPE_SECRET_KEY=sk_... node archiveHitAlickStripeProducts.mjs --apply
 */

import Stripe from "stripe";

const secret = process.env.STRIPE_SECRET_KEY;
const dryRun = process.argv.includes("--dry-run") || !process.argv.includes("--apply");

if (!secret) {
  console.error("Set STRIPE_SECRET_KEY");
  process.exit(1);
}

const stripe = new Stripe(secret);

async function main() {
  const products = [];
  let startingAfter;
  for (;;) {
    const page = await stripe.products.list({ active: true, limit: 100, starting_after: startingAfter });
    for (const p of page.data) {
      if (p.metadata?.hitalick_app === "1") products.push(p);
    }
    if (!page.has_more) break;
    startingAfter = page.data[page.data.length - 1]?.id;
    if (!startingAfter) break;
  }
  console.log(`Found ${products.length} active Hit-A-Lick-tagged products (hitalick_app=1).`);
  for (const p of products) {
    console.log(` - ${p.id}  ${p.name}`);
    if (!dryRun) {
      await stripe.products.update(p.id, { active: false });
      console.log("   archived.");
    }
  }
  if (dryRun) {
    console.log("\nDry run only. Re-run with --apply to deactivate these products.");
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
