# Curator passes — positioning and pricing

## Product shape

- **Four named curator lanes**: Giap Pick’s, Bruce Pick’s, Mike Pick’s, Toriano Pick’s. Each lane has its own board sourced from the **universal pick pool** (owner-managed). Curators **select** which pool rows they publish as “upcoming.” Settled results are logged into **history** only for legs that were actually played — not every row that ever appeared in the pool.
- **All-access bundle**: one Stripe subscription that sets `metadata.curators=all` (see `billing.js` / `all_curators` price). In Firestore, `entitlement.curatorAllAccess` is true and all four feeds unlock.
- **Single-curator passes**: `curator_giap`, `curator_bruce`, `curator_mike`, `curator_toriano` map to Stripe prices; webhook stores the slug in `stripeSubscriptions` and `entitlement.curatorIds`.

## Anti double-pay

- **Stripe is the source of truth**: users manage subscriptions in the **Customer Portal**; avoid selling overlapping products outside Stripe.
- **In-app merge rule** (`recomputeEntitlementFromSubscriptions`): if any active subscription has `curators=all`, that **wins** over individual curator lines — users should **upgrade** to the bundle in the portal instead of stacking duplicate monthly charges for every lane.
- **Messaging**: “Already subscribed to one curator? Upgrade to All Curators in the portal — we don’t stack duplicate lane fees on purpose.”

## Suggested public pricing (you set exact amounts in Stripe)

| SKU | Audience | Value prop |
| --- | --- | --- |
| Single curator | Casual tailers | One voice, one board, full history for that curator |
| All curators | Serious bettors | One price for Giap + Bruce + Mike + Toriano; best unit economics |
| Legacy Bruce Picks / Premium JSON boards | Existing members | Still served via `/picks/bruce` and `/picks/premium` for continuity |

Tune list prices to your market; keep **bundle < sum of four singles** to push all-access.

## Copy hooks

- **Transparency**: “Upcoming = universal pool picks the curator actually selected. History = settled picks only.”
- **No tickets placed in-app**: educational analytics; verify on the book.
- **AI Lab**: parlay math and copilot are **filters and coaching**, not guaranteed outcomes.

## Ops checklist

1. Create Stripe products/prices for each curator + bundle; set env `STRIPE_PRICE_CURATOR_*` and `STRIPE_PRICE_ALL_CURATORS`.
2. Set Firebase Auth emails for each curator and env vars **`CURATOR_GIAP_EMAIL`**, **`CURATOR_MIKE_EMAIL`**, **`CURATOR_TORIANO_EMAIL`** (Bruce defaults to `OWNER_EMAIL` in `curators.js`).
3. Owner seeds `universalPickPool` via `POST /api/curators/pool/add` (see `curators.js`).
4. Each curator calls `POST /api/curators/:id/select` with `pickIds` to publish upcoming legs.
