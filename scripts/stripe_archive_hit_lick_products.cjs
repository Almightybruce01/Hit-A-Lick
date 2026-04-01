/**
 * Archives (deactivates) Stripe products that belong ONLY to Hit-A-Lick:
 *   metadata hit_a_lick === "1"
 *
 *   DRY_RUN=1 STRIPE_SECRET_KEY=sk_xxx node scripts/stripe_archive_hit_lick_products.cjs
 *
 * Omit DRY_RUN to actually set active=false on those products. Other apps in the same Stripe account are untouched.
 */

const Stripe = require("../functions/node_modules/stripe");

const secret = process.env.STRIPE_SECRET_KEY;
const dry = String(process.env.DRY_RUN || "").trim() === "1";

if (!secret) {
  console.error("Set STRIPE_SECRET_KEY");
  process.exit(1);
}

const stripe = new Stripe(secret);

async function main() {
  let startingAfter;
  let archived = 0;
  for (;;) {
    const page = await stripe.products.list({ limit: 100, active: true, starting_after: startingAfter });
    for (const p of page.data) {
      if (p.metadata?.hit_a_lick !== "1") continue;
      console.log(`${dry ? "[dry-run]" : ""} archive product ${p.id} (${p.name})`);
      if (!dry) {
        await stripe.products.update(p.id, { active: false });
        archived += 1;
      }
    }
    if (!page.has_more) break;
    startingAfter = page.data[page.data.length - 1].id;
  }
  console.log(dry ? "Dry run complete." : `Archived ${archived} Hit-A-Lick product(s).`);
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
